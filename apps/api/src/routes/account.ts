import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { withTransaction,lockKey } from '../db.js';
import { ApiError } from '../errors.js';
import type { Authenticator } from '../types.js';
import { environmentSchema, modalitySchema, iso, idParams } from '../types.js';
import { audit, notifyGroup } from '../services/groups.js';
import { recomputeChallenge } from '../services/scoring.js';
const preferencesSchema = z.object({
  goal:z.enum(['health','strength','conditioning']),level:z.enum(['beginner','intermediate','advanced']),
  availableDays:z.array(z.number().int().min(1).max(7)).min(1).max(7).transform(v=>[...new Set(v)]),
  durationMinutes:z.number().int().min(5).max(180),environment:environmentSchema,
  equipment:z.array(z.string().min(1).max(60)).max(40),modalities:z.array(modalitySchema).min(1).max(7),
  avoidExerciseIds:z.array(z.string().min(1).max(80)).max(200),
  timezone:z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('pt-BR',{timeZone:value});return true;}catch{return false;}},'Fuso horário inválido.'),
}).strict();
const notificationSchema=z.object({
  enabled:z.boolean(),days:z.array(z.number().int().min(1).max(7)).max(7),
  hour:z.number().int().min(0).max(23),minute:z.number().int().min(0).max(59),
  quietStartMinute:z.number().int().min(0).max(1439),quietEndMinute:z.number().int().min(0).max(1439),
}).strict();
const defaultNotifications={enabled:false,days:[],hour:18,minute:0,quietStartMinute:1320,quietEndMinute:420};
export function registerAccountRoutes(app:FastifyInstance,{pool,authenticate}:{pool:Pool;authenticate:Authenticator}) {
  const secured={preHandler:authenticate};
  async function me(userId:string) {
    const result=await pool.query('SELECT u.id,u.display_name,u.avatar_url,EXISTS(SELECT 1 FROM user_preferences p WHERE p.user_id=u.id) AS onboarded FROM users u WHERE u.id=$1',[userId]);
    const row=result.rows[0];
    if(!row)throw new ApiError(404,'ACCOUNT_NOT_FOUND','Conta não encontrada.');
    return {id:row.id,displayName:row.display_name,avatarUrl:row.avatar_url,onboardingComplete:row.onboarded};
  }
  app.get('/me',secured,request=>me(request.user.id));
  app.patch('/me',secured,async request=>{
    const input=z.object({displayName:z.string().trim().min(1).max(80),avatarUrl:z.null().optional()}).strict().parse(request.body);
    await pool.query('UPDATE users SET display_name=$2,avatar_url=CASE WHEN $3 THEN NULL ELSE avatar_url END WHERE id=$1',[request.user.id,input.displayName,input.avatarUrl===null]);
    return me(request.user.id);
  });
  app.post('/me/avatar',{...secured,bodyLimit:450000},async request=>{
    const input=z.object({base64:z.string().min(8).max(410000),mimeType:z.enum(['image/jpeg','image/png'])}).strict().parse(request.body);
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))throw new ApiError(400,'INVALID_IMAGE','Imagem inválida.');
    const bytes=Buffer.from(input.base64,'base64');
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(bytes.length>300000||(input.mimeType==='image/png'?!png:!jpeg))throw new ApiError(400,'INVALID_IMAGE','Use uma imagem PNG ou JPEG de até 300 KB.');
    await pool.query('UPDATE users SET avatar_url=$2 WHERE id=$1',[request.user.id,'data:'+input.mimeType+';base64,'+bytes.toString('base64')]);
    return me(request.user.id);
  });
  app.get('/me/preferences',secured,async request=>{
    const result=await pool.query('SELECT payload FROM user_preferences WHERE user_id=$1',[request.user.id]);
    if(!result.rowCount)throw new ApiError(404,'PREFERENCES_REQUIRED','Defina suas preferências para receber uma sugestão.');
    return result.rows[0].payload;
  });
  app.patch('/me/preferences',secured,async request=>{
    const input=preferencesSchema.parse(request.body);
    await pool.query('INSERT INTO user_preferences(user_id,payload) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=clock_timestamp()',[request.user.id,JSON.stringify(input)]);
    return input;
  });
  app.get('/me/notifications',secured,async request=>{
    const result=await pool.query('SELECT notification_settings FROM user_preferences WHERE user_id=$1',[request.user.id]);
    return result.rows[0]?.notification_settings??defaultNotifications;
  });
  app.patch('/me/notifications',secured,async request=>{
    const input=notificationSchema.parse(request.body);
    const result=await pool.query('UPDATE user_preferences SET notification_settings=$2,updated_at=clock_timestamp() WHERE user_id=$1 RETURNING user_id',[request.user.id,JSON.stringify(input)]);
    if(!result.rowCount)throw new ApiError(428,'PREFERENCES_REQUIRED','Conclua a personalização inicial.');
    return input;
  });
  app.get('/notifications',secured,async request=>{
    const result=await pool.query('SELECT id,group_id,challenge_id,title,message,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[request.user.id]);
    return {items:result.rows.map(r=>({id:r.id,groupId:r.group_id,challengeId:r.challenge_id,title:r.title,message:r.message,readAt:iso(r.read_at),createdAt:iso(r.created_at)}))};
  });
  app.patch('/notifications/:id/read',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const result=await pool.query('UPDATE notifications SET read_at=COALESCE(read_at,clock_timestamp()) WHERE id=$1 AND user_id=$2 RETURNING id,read_at',[id,request.user.id]);
    if(!result.rowCount)throw new ApiError(404,'NOTIFICATION_NOT_FOUND','Aviso não encontrado.');
    return {id,readAt:iso(result.rows[0].read_at)};
  });
  app.delete('/me',secured,async request=>{
    z.object({confirm:z.literal(true)}).parse(request.body);
    await withTransaction(pool,async client=>{
      await lockKey(client,'user-activities:'+request.user.id);
      const memberships=await client.query('SELECT g.id FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=$1 ORDER BY g.id FOR UPDATE OF g',[request.user.id]);
      const affected=await client.query('SELECT c.id FROM challenges c JOIN group_members m ON m.group_id=c.group_id WHERE m.user_id=$1 ORDER BY c.id',[request.user.id]);
      for(const challenge of affected.rows)await lockKey(client,'challenge:'+challenge.id);
      for(const group of memberships.rows){
        const admins=await client.query("SELECT user_id FROM group_members WHERE group_id=$1 AND role='admin' AND user_id<>$2",[group.id,request.user.id]);
        if(!admins.rowCount){
          const successor=await client.query('SELECT user_id FROM group_members WHERE group_id=$1 AND user_id<>$2 ORDER BY joined_at,user_id LIMIT 1',[group.id,request.user.id]);
          if(successor.rowCount){
            await client.query("UPDATE group_members SET role='admin' WHERE group_id=$1 AND user_id=$2",[group.id,successor.rows[0].user_id]);
            await notifyGroup(client,group.id,null,'Administração atualizada','A conta de um participante foi excluída. O grupo recebeu um novo administrador.');
          }
        }
      }
      await client.query('DELETE FROM users WHERE id=$1',[request.user.id]);
      for(const group of memberships.rows){
        const count=await client.query('SELECT 1 FROM group_members WHERE group_id=$1 LIMIT 1',[group.id]);
        if(!count.rowCount){await client.query('DELETE FROM groups WHERE id=$1',[group.id]);continue;}
        const challenges=await client.query('SELECT id FROM challenges WHERE group_id=$1 ORDER BY id',[group.id]);
        for(const challenge of challenges.rows)await recomputeChallenge(client,challenge.id);
      }
    });
    return {deleted:true};
  });
}
