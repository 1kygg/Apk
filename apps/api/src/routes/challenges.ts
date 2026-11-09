import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { withTransaction,lockKey } from '../db.js';
import { ApiError } from '../errors.js';
import { idParams,iso } from '../types.js';
import type { Authenticator } from '../types.js';
import { audit,notifyGroup,requireMembership,requireChallenge } from '../services/groups.js';
import { parseRules,recomputeChallenge,scoreForRules } from '../services/scoring.js';
import { calculateMaximum } from '@consta/domain';
import { hashToken } from '../services/auth.js';
export function challengeDto(row:Record<string,any>){
  const rules=parseRules(row.rules);
  return {id:row.id,groupId:row.group_id,name:row.name,description:row.description,rules,revision:row.revision,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),rankingUpdatedAt:iso(row.ranking_updated_at),maximum:calculateMaximum(rules)};
}
const reasonSchema=z.string().trim().min(8).max(1000);
export function registerChallengeRoutes(app:FastifyInstance,{pool,authenticate}:{pool:Pool;authenticate:Authenticator}){
  const secured={preHandler:authenticate};
  app.post('/challenges/preview',secured,async request=>{
    const {rules:raw}=z.object({rules:z.unknown()}).strict().parse(request.body);
    const rules=parseRules(raw);
    return {rules,maximum:calculateMaximum(rules)};
  });
  app.get('/groups/:id/challenges',secured,async request=>{
    const {id}=idParams.parse(request.params);
    await requireMembership(pool,id,request.user.id);
    const result=await pool.query('SELECT * FROM challenges WHERE group_id=$1 ORDER BY created_at DESC',[id]);
    return {items:result.rows.map(challengeDto)};
  });
  app.post('/groups/:id/challenges',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const input=z.object({name:z.string().trim().min(1).max(100),description:z.string().max(3000).default(''),rules:z.unknown()}).strict().parse(request.body);
    const rules=parseRules(input.rules);
    return withTransaction(pool,async client=>{
      await requireMembership(client,id,request.user.id,true);
      const result=await client.query('INSERT INTO challenges(group_id,name,description,rules,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,input.name,input.description,JSON.stringify(rules),request.user.id]);
      await audit(client,{groupId:id,challengeId:result.rows[0].id,actorId:request.user.id,action:'challenge_created',details:{rules}});
      await notifyGroup(client,id,result.rows[0].id,'Novo desafio',input.name+' está disponível. Consulte o regulamento antes de participar.');
      await recomputeChallenge(client,result.rows[0].id);
      return challengeDto(result.rows[0]);
    });
  });
  app.get('/challenges/:id',secured,async request=>{
    const {id}=idParams.parse(request.params);
    return challengeDto(await requireChallenge(pool,id,request.user.id));
  });
  app.post('/challenges/:id/preview-change',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const input=z.object({rules:z.unknown(),reason:reasonSchema}).strict().parse(request.body);
    const rules=parseRules(input.rules);
    return withTransaction(pool,async client=>{
      await lockKey(client,'challenge:'+id);
      const challenge=await requireChallenge(client,id,request.user.id,true);
      const before=await scoreForRules(client,challenge);
      const after=await scoreForRules(client,challenge,rules);
      const token=randomBytes(32).toString('base64url');
      await client.query('DELETE FROM challenge_change_previews WHERE challenge_id=$1 AND requested_by=$2',[id,request.user.id]);
      const created=await client.query('INSERT INTO challenge_change_previews(challenge_id,requested_by,revision,rules,token_hash,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING expires_at',[id,request.user.id,challenge.revision,JSON.stringify(rules),hashToken(token),input.reason]);
      return {changeToken:token,expiresAt:iso(created.rows[0].expires_at),revision:challenge.revision,before:{items:before.ranking},after:{items:after.ranking},maximum:after.maximum};
    });
  });
  app.patch('/challenges/:id',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const input=z.object({name:z.string().trim().min(1).max(100).optional(),description:z.string().max(3000).optional(),rules:z.unknown().optional(),reason:reasonSchema.optional(),changeToken:z.string().min(32).max(200).optional(),expectedRevision:z.number().int().positive().optional()}).strict().parse(request.body);
    return withTransaction(pool,async client=>{
      await lockKey(client,'challenge:'+id);
      const challenge=await requireChallenge(client,id,request.user.id,true);
      await client.query('SELECT id FROM challenges WHERE id=$1 FOR UPDATE',[id]);
      if(input.expectedRevision!=null&&input.expectedRevision!==challenge.revision)throw new ApiError(409,'STALE_REVISION','O desafio foi alterado. Atualize os dados.');
      const currentRules=parseRules(challenge.rules);
      const rules=input.rules===undefined?currentRules:parseRules(input.rules);
      const rulesChanged=JSON.stringify(rules)!==JSON.stringify(currentRules);
      const clock=await client.query('SELECT clock_timestamp() AS now');
      const started=new Date(currentRules.startsAt).getTime()<=new Date(clock.rows[0].now).getTime();
      if(started&&!input.reason)throw new ApiError(400,'CHANGE_REASON_REQUIRED','Informe o motivo da alteração iniciada.');
      if(started&&rulesChanged){
        if(!input.changeToken)throw new ApiError(409,'PREVIEW_REQUIRED','Revise o impacto na classificação antes de confirmar esta alteração.');
        const preview=await client.query('SELECT * FROM challenge_change_previews WHERE challenge_id=$1 AND requested_by=$2 AND token_hash=$3 AND expires_at>clock_timestamp() FOR UPDATE',[id,request.user.id,hashToken(input.changeToken)]);
        const row=preview.rows[0];
        if(!row||row.revision!==challenge.revision||row.reason!==input.reason||JSON.stringify(parseRules(row.rules))!==JSON.stringify(rules))throw new ApiError(409,'STALE_PREVIEW','A prévia expirou ou mudou. Gere outra prévia.');
        await client.query('DELETE FROM challenge_change_previews WHERE id=$1',[row.id]);
      }
      const updated=await client.query('UPDATE challenges SET name=$2,description=$3,rules=$4,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[id,input.name??challenge.name,input.description??challenge.description,JSON.stringify(rules)]);
      await audit(client,{groupId:challenge.group_id,challengeId:id,actorId:request.user.id,action:'challenge_updated',reason:input.reason,details:{revision:updated.rows[0].revision,previousRules:currentRules,nextRules:rules,retroactiveRecalculation:started&&rulesChanged}});
      await recomputeChallenge(client,id);
      await notifyGroup(client,challenge.group_id,id,'Regulamento atualizado',String(updated.rows[0].name)+': '+(input.reason??'As configurações foram atualizadas antes do início.')+(started&&rulesChanged?' A classificação foi recalculada após confirmação da prévia.':''));
      const final=await client.query('SELECT * FROM challenges WHERE id=$1',[id]);
      return challengeDto(final.rows[0]);
    });
  });
  app.post('/challenges/:id/duplicate',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const input=z.object({name:z.string().trim().min(1).max(100).optional(),startsAt:z.string().datetime(),endsAt:z.string().datetime()}).strict().parse(request.body);
    return withTransaction(pool,async client=>{
      const old=await requireChallenge(client,id,request.user.id,true);
      const clock=await client.query('SELECT clock_timestamp() AS now');
      if(Date.parse(input.startsAt)<=new Date(clock.rows[0].now).getTime())throw new ApiError(400,'NEW_DATES_REQUIRED','Defina uma nova data de início futura.');
      const rules=parseRules({...parseRules(old.rules),startsAt:input.startsAt,endsAt:input.endsAt});
      const result=await client.query('INSERT INTO challenges(group_id,name,description,rules,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[old.group_id,input.name??old.name,old.description,JSON.stringify(rules),request.user.id]);
      await audit(client,{groupId:old.group_id,challengeId:result.rows[0].id,actorId:request.user.id,action:'challenge_duplicated',details:{originalChallengeId:id}});
      await notifyGroup(client,old.group_id,result.rows[0].id,'Novo desafio','Um desafio foi criado com novas datas. Consulte o regulamento.');
      return challengeDto(result.rows[0]);
    });
  });
  app.get('/challenges/:id/ranking',secured,async request=>{
    const {id}=idParams.parse(request.params);
    return withTransaction(pool,async client=>{
      await requireChallenge(client,id,request.user.id);
      const scored=await recomputeChallenge(client,id);
      if(!scored)throw new ApiError(404,'CHALLENGE_NOT_FOUND','Desafio não encontrado.');
      return {items:scored.ranking,updatedAt:scored.updatedAt,unit:scored.result.unit,maximum:scored.maximum,rules:scored.rules,revision:scored.revision};
    });
  });
}
