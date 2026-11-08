import { z } from 'zod';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { withTransaction,lockKey } from '../db.js';
import { ApiError } from '../errors.js';
import { idParams,uuid,iso } from '../types.js';
import type { Authenticator } from '../types.js';
import { activityDto,createActivityService,detectMetricAnomalies } from '../services/activities.js';
import { audit,notifyGroup,requireChallenge,requireMembership } from '../services/groups.js';
import { parseRules,recomputeChallenge,recomputeUserGroups } from '../services/scoring.js';
export function registerActivityRoutes(app:FastifyInstance,{pool,authenticate,service}:{pool:Pool;authenticate:Authenticator;service:ReturnType<typeof createActivityService>}){
  const secured={preHandler:authenticate};
  app.get('/activities',secured,async request=>{
    const query=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),before:z.string().datetime().optional()}).parse(request.query);
    const result=await pool.query('SELECT *,clock_timestamp() AS server_time FROM activities WHERE user_id=$1 AND ($2::timestamptz IS NULL OR started_at<$2) ORDER BY started_at DESC,id DESC LIMIT $3',[request.user.id,query.before??null,query.limit]);
    return {items:result.rows.map(activityDto)};
  });
  app.get('/activities/:id',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const result=await pool.query('SELECT *,clock_timestamp() AS server_time FROM activities WHERE id=$1 AND user_id=$2',[id,request.user.id]);
    if(!result.rowCount)throw new ApiError(404,'ACTIVITY_NOT_FOUND','Atividade não encontrada.');
    return activityDto(result.rows[0]);
  });
  app.post('/activities/start',secured,request=>service.startActivity(request.user.id,request.body as Parameters<typeof service.startActivity>[1]));
  app.post('/activities/:id/complete',secured,request=>service.completeActivity(request.user.id,idParams.parse(request.params).id,request.body as Parameters<typeof service.completeActivity>[2]));
  app.post('/activities/import',secured,request=>service.importActivity(request.user.id,request.body));
  app.delete('/activities/:id',secured,async request=>{
    const {id}=idParams.parse(request.params);
    await withTransaction(pool,async client=>{
      await lockKey(client,'user-activities:'+request.user.id);
      const affected=await client.query('SELECT c.id FROM challenges c JOIN group_members m ON m.group_id=c.group_id WHERE m.user_id=$1 ORDER BY c.id',[request.user.id]);
      for(const challenge of affected.rows)await lockKey(client,'challenge:'+challenge.id);
      const found=await client.query('SELECT user_id FROM activities WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,request.user.id]);
      if(!found.rowCount)throw new ApiError(404,'ACTIVITY_NOT_FOUND','Atividade não encontrada.');
      const groups=await client.query('SELECT group_id FROM group_members WHERE user_id=$1 ORDER BY group_id',[request.user.id]);
      // Keep the immutable exercise snapshot but erase this session's private execution data.
      await client.query('DELETE FROM daily_plan_events WHERE plan_id IN (SELECT id FROM daily_plans WHERE activity_id=$1)',[id]);
      await client.query("UPDATE daily_plans SET activity_id=NULL,progress=$2,completion_payload=NULL,status='completed',finished_at=COALESCE(finished_at,clock_timestamp()) WHERE activity_id=$1",[id,JSON.stringify({sets:{},adaptations:{},notes:''})]);
      await client.query('DELETE FROM activities WHERE id=$1',[id]);
      for(const group of groups.rows)await audit(client,{groupId:group.group_id,actorId:request.user.id,action:'activity_deleted',details:{activityId:id}});
      await recomputeUserGroups(client,request.user.id);
    });
    return {deleted:true};
  });
  app.get('/challenges/:id/review-queue',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const challenge=await requireChallenge(pool,id,request.user.id,true);
    const rules=parseRules(challenge.rules);
    const result=await pool.query(`SELECT a.*,u.display_name,r.decision FROM activities a JOIN group_members m ON m.user_id=a.user_id AND m.group_id=$1 JOIN users u ON u.id=a.user_id LEFT JOIN activity_reviews r ON r.activity_id=a.id AND r.challenge_id=$2 WHERE a.status='completed' AND (a.eligibility<>'verified' OR r.decision IS NOT NULL) AND COALESCE(a.recorded_start_at,a.started_at)<=$4 AND COALESCE(a.recorded_end_at,a.ended_at)>=$3 ORDER BY a.received_at DESC LIMIT 100`,[challenge.group_id,id,rules.startsAt,rules.endsAt]);
    return {items:result.rows.filter(r=>rules.allowedModalities.includes(r.modality)&&rules.acceptedSources.includes(r.source)).map(r=>({
      activityId:r.id,userId:r.user_id,displayName:r.display_name,modality:r.modality,source:r.source,eligibility:r.eligibility,
      ineligibleReason:r.ineligible_reason,recordedStartAt:iso(r.recorded_start_at??r.started_at),recordedEndAt:iso(r.recorded_end_at??r.ended_at),
      activeSeconds:r.active_seconds,distanceMeters:rules.type==='walking'||rules.type==='running'||rules.type==='cycling'?r.distance_meters:null,
      steps:rules.type==='steps'?r.steps:null,decision:r.decision??null,
    }))};
  });
  app.post('/activities/:id/review',secured,async request=>{
    const {id}=idParams.parse(request.params);
    const input=z.object({
      challengeId:uuid,decision:z.enum(['approve','reject']),reason:z.string().trim().min(8).max(1000),
      correctedStartAt:z.string().datetime().optional(),correctedEndAt:z.string().datetime().optional(),
      distanceMeters:z.number().finite().min(0).max(2000000).optional(),
      activeSeconds:z.number().int().min(0).max(604800).optional(),
    }).strict().parse(request.body);
    return withTransaction(pool,async client=>{
      const owner=await client.query('SELECT user_id FROM activities WHERE id=$1',[id]);
      if(!owner.rowCount)throw new ApiError(404,'ACTIVITY_NOT_FOUND','Registro concluído não encontrado.');
      await lockKey(client,'user-activities:'+owner.rows[0].user_id);
      await lockKey(client,'challenge:'+input.challengeId);
      const challenge=await requireChallenge(client,input.challengeId,request.user.id,true);
      const rules=parseRules(challenge.rules);
      const found=await client.query('SELECT *,clock_timestamp() AS now FROM activities WHERE id=$1 FOR NO KEY UPDATE',[id]);
      const activity=found.rows[0];
      if(!activity||activity.status!=='completed')throw new ApiError(404,'ACTIVITY_NOT_FOUND','Registro concluído não encontrado.');
      await requireMembership(client,challenge.group_id,activity.user_id);
      if(!rules.allowedModalities.includes(activity.modality)||!rules.acceptedSources.includes(activity.source))throw new ApiError(400,'SOURCE_NOT_ACCEPTED','O regulamento não aceita esta modalidade ou fonte.');
      const untrustedClock=!activity.server_started||activity.recorded_end_at!=null;
      if(input.decision==='approve'&&untrustedClock&&rules.offlinePolicy!=='review')throw new ApiError(400,'OFFLINE_REJECTED_BY_RULES','O regulamento não permite aprovar horários sem verificação. Altere a regra com prévia e auditoria, se necessário.');
      const start=input.correctedStartAt??iso(activity.recorded_start_at??activity.started_at)!;
      const end=input.correctedEndAt??iso(activity.recorded_end_at??activity.ended_at)!;
      const activeSeconds=input.activeSeconds??activity.active_seconds;
      if(Date.parse(end)<Date.parse(start)||Date.parse(end)>new Date(activity.now).getTime()+1000||activeSeconds>(Date.parse(end)-Date.parse(start))/1000+1)throw new ApiError(400,'INVALID_INTERVAL','Confira os horários e o tempo ativo corrigidos.');
      const distance=input.distanceMeters??activity.distance_meters;
      if(input.decision==='approve'&&detectMetricAnomalies(activity.modality,activeSeconds,distance??undefined).length)throw new ApiError(400,'METRICS_UNREASONABLE','Corrija a distância ou o tempo antes de aprovar o registro.');
      const result=await client.query('INSERT INTO activity_reviews(challenge_id,activity_id,reviewer_id,decision,reason,corrected_start_at,corrected_end_at,corrected_distance_meters,corrected_active_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(challenge_id,activity_id) DO UPDATE SET reviewer_id=EXCLUDED.reviewer_id,decision=EXCLUDED.decision,reason=EXCLUDED.reason,corrected_start_at=EXCLUDED.corrected_start_at,corrected_end_at=EXCLUDED.corrected_end_at,corrected_distance_meters=EXCLUDED.corrected_distance_meters,corrected_active_seconds=EXCLUDED.corrected_active_seconds,reviewed_at=clock_timestamp() RETURNING reviewed_at',[input.challengeId,id,request.user.id,input.decision,input.reason,start,end,distance,activeSeconds]);
      await audit(client,{groupId:challenge.group_id,challengeId:input.challengeId,actorId:request.user.id,action:'activity_reviewed',reason:input.reason,details:{activityId:id,decision:input.decision}});
      await recomputeChallenge(client,input.challengeId);
      await notifyGroup(client,challenge.group_id,input.challengeId,'Classificação atualizada','Um registro foi revisado com justificativa. Consulte a auditoria do desafio.');
      return {activityId:id,challengeId:input.challengeId,decision:input.decision,reviewedAt:iso(result.rows[0].reviewed_at)};
    });
  });
}
