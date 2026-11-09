import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { idParams, uuid, iso } from '../types.js';
import type { Authenticator } from '../types.js';
import { hashToken } from '../services/auth.js';
import { audit,notifyGroup,requireMembership } from '../services/groups.js';
import { recomputeChallenge } from '../services/scoring.js';
const groupInput=z.object({name:z.string().trim().min(1).max(80),description:z.string().max(1000).default('')}).strict();
export function registerGroupRoutes(app:FastifyInstance,{pool,authenticate}:{pool:Pool;authenticate:Authenticator}){
  const secured={preHandler:authenticate};
  const dto=(r:Record<string,any>)=>({id:r.id,name:r.name,description:r.description,role:r.role,memberCount:Number(r.member_count??0),createdAt:iso(r.created_at)});
  app.get('/groups',secured,async request=>{
    const result=await pool.query('SELECT g.*,m.role,(SELECT count(*) FROM group_members n WHERE n.group_id=g.id) AS member_count FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=$1 ORDER BY g.created_at DESC',[request.user.id]);
    return {items:result.rows.map(dto)};
  });
  app.post('/groups',secured,async request=>{
    const input=groupInput.parse(request.body);
    return withTransaction(pool,async client=>{
      const result=await client.query('INSERT INTO groups(name,description,created_by) VALUES($1,$2,$3) RETURNING *',[input.name,input.description,request.user.id]);
      const row=result.rows[0];
      await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'admin')",[row.id,request.user.id]);
      await audit(client,{groupId:row.id,actorId:request.user.id,action:'group_created'});
      return dto({...row,role:'admin',member_count:1});
    });
  });
  app.get('/groups/:id',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const row=await requireMembership(pool,id,request.user.id);
    const count=await pool.query('SELECT count(*) AS count FROM group_members WHERE group_id=$1',[id]);
    return dto({...row,member_count:count.rows[0].count});
  });
  app.patch('/groups/:id',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const input=groupInput.partial().parse(request.body);
    return withTransaction(pool,async client=>{
      await client.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE',[id]);
      const group=await requireMembership(client,id,request.user.id,true);
      const result=await client.query('UPDATE groups SET name=$2,description=$3 WHERE id=$1 RETURNING *',[id,input.name??group.name,input.description??group.description]);
      await audit(client,{groupId:id,actorId:request.user.id,action:'group_updated'});
      const count=await client.query('SELECT count(*) AS count FROM group_members WHERE group_id=$1',[id]);
      return dto({...result.rows[0],role:'admin',member_count:count.rows[0].count});
    });
  });
  app.delete('/groups/:id',secured,async request=>{
    const {id}=idParams.parse(request.params);
    z.object({confirm:z.literal(true)}).parse(request.body);
    await withTransaction(pool,async client=>{
      await client.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE',[id]);
      await requireMembership(client,id,request.user.id,true);
      await client.query('DELETE FROM groups WHERE id=$1',[id]);
    });
    return {deleted:true};
  });
  app.get('/groups/:id/members',secured,async request=>{
    const {id}=idParams.parse(request.params);
    await requireMembership(pool,id,request.user.id);
    const result=await pool.query('SELECT u.id AS user_id,u.display_name,u.avatar_url,m.role,m.joined_at FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=$1 ORDER BY m.joined_at,u.id',[id]);
    return {items:result.rows.map(r=>({userId:r.user_id,displayName:r.display_name,avatarUrl:r.avatar_url,role:r.role,joinedAt:iso(r.joined_at)}))};
  });
  app.patch('/groups/:id/members/:userId',secured,async request=>{
    const {id,userId}=z.object({id:uuid,userId:uuid}).parse(request.params);
    const input=z.object({role:z.enum(['admin','member'])}).strict().parse(request.body);
    await withTransaction(pool,async client=>{
      await client.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE',[id]);
      await requireMembership(client,id,request.user.id,true);
      const member=await client.query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2',[id,userId]);
      if(!member.rowCount)throw new ApiError(404,'MEMBER_NOT_FOUND','Participante não encontrado.');
      if(member.rows[0].role==='admin'&&input.role==='member'){
        const count=await client.query("SELECT count(*) AS count FROM group_members WHERE group_id=$1 AND role='admin'",[id]);
        if(Number(count.rows[0].count)<=1)throw new ApiError(409,'LAST_ADMIN','Mantenha pelo menos um administrador.');
      }
      await client.query('UPDATE group_members SET role=$3 WHERE group_id=$1 AND user_id=$2',[id,userId,input.role]);
      await audit(client,{groupId:id,actorId:request.user.id,action:'member_role_changed',details:{userId,role:input.role}});
      await notifyGroup(client,id,null,'Administração atualizada','As permissões de um participante foram alteradas. Consulte o histórico do grupo.');
    });
    return {userId,role:input.role};
  });
  app.delete('/groups/:id/members/:userId',secured,async request=>{
    const {id,userId}=z.object({id:uuid,userId:uuid}).parse(request.params);
    await withTransaction(pool,async client=>{
      await client.query('SELECT id FROM groups WHERE id=$1 FOR UPDATE',[id]);
      await requireMembership(client,id,request.user.id,userId!==request.user.id);
      const target=await client.query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2',[id,userId]);
      if(!target.rowCount)throw new ApiError(404,'MEMBER_NOT_FOUND','Participante não encontrado.');
      if(target.rows[0].role==='admin'){
        const count=await client.query("SELECT count(*) AS count FROM group_members WHERE group_id=$1 AND role='admin'",[id]);
        if(Number(count.rows[0].count)<=1)throw new ApiError(409,'LAST_ADMIN','Transfira a administração antes de sair ou exclua o grupo.');
      }
      await client.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',[id,userId]);
      await audit(client,{groupId:id,actorId:request.user.id,action:'member_removed',details:{userId}});
      const challenges=await client.query('SELECT id FROM challenges WHERE group_id=$1 ORDER BY id',[id]);
      for(const challenge of challenges.rows)await recomputeChallenge(client,challenge.id);
    });
    return {deleted:true};
  });
  app.post('/groups/:id/invites',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const input=z.object({expiresInDays:z.number().int().min(1).max(30).default(7)}).parse(request.body??{});
    return withTransaction(pool,async client=>{
      await requireMembership(client,id,request.user.id,true);
      const code=randomBytes(24).toString('base64url');
      const result=await client.query("INSERT INTO group_invites(group_id,code_hash,created_by,expires_at) VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 day') RETURNING id,expires_at",[id,hashToken(code),request.user.id,input.expiresInDays]);
      await audit(client,{groupId:id,actorId:request.user.id,action:'invite_created',details:{inviteId:result.rows[0].id}});
      return {id:result.rows[0].id,code,url:'consta://invite/'+code,expiresAt:iso(result.rows[0].expires_at)};
    });
  });
  app.get('/groups/:id/invites',secured,async request=>{
    const {id}=idParams.parse(request.params);
    await requireMembership(pool,id,request.user.id,true);
    const result=await pool.query('SELECT id,expires_at,revoked_at,created_at FROM group_invites WHERE group_id=$1 ORDER BY created_at DESC',[id]);
    return {items:result.rows.map(r=>({id:r.id,expiresAt:iso(r.expires_at),revokedAt:iso(r.revoked_at),createdAt:iso(r.created_at)}))};
  });
  app.delete('/groups/:id/invites/:inviteId',secured,async request=>{
    const {id,inviteId}=z.object({id:uuid,inviteId:uuid}).parse(request.params);
    await withTransaction(pool,async client=>{
      await requireMembership(client,id,request.user.id,true);
      const result=await client.query('UPDATE group_invites SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1 AND group_id=$2 RETURNING id',[inviteId,id]);
      if(!result.rowCount)throw new ApiError(404,'INVITE_NOT_FOUND','Convite não encontrado.');
      await audit(client,{groupId:id,actorId:request.user.id,action:'invite_revoked',details:{inviteId}});
    });
    return {revoked:true};
  });
  app.post('/invites/accept',{...secured,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async request=>{
    const {code}=z.object({code:z.string().min(16).max(200)}).strict().parse(request.body);
    return withTransaction(pool,async client=>{
      const result=await client.query('SELECT * FROM group_invites WHERE code_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE',[hashToken(code)]);
      const invite=result.rows[0];
      if(!invite)throw new ApiError(404,'INVALID_INVITE','Convite expirado, revogado ou inválido.');
      await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING",[invite.group_id,request.user.id]);
      await audit(client,{groupId:invite.group_id,actorId:request.user.id,action:'invite_accepted'});
      return {groupId:invite.group_id};
    });
  });
  app.get('/groups/:id/audit',secured,async request=>{
    const {id}=idParams.parse(request.params);
    await requireMembership(pool,id,request.user.id);
    const result=await pool.query('SELECT a.*,u.display_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.group_id=$1 ORDER BY a.created_at DESC LIMIT 200',[id]);
    return {items:result.rows.map(r=>({id:r.id,challengeId:r.challenge_id,actorDisplayName:r.display_name??'Conta excluída',action:r.action,reason:r.reason,details:r.details,createdAt:iso(r.created_at)}))};
  });
}
