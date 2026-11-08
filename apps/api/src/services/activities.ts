import { z } from 'zod';
import type { Pool } from 'pg';
import { withTransaction, lockKey } from '../db.js';
import { ApiError } from '../errors.js';
import { modalitySchema, sourceSchema, environmentSchema, uuid, iso } from '../types.js';
import { recomputeUserGroups } from './scoring.js';
import { hashToken } from './auth.js';
export const startActivitySchema = z.object({
  clientId: uuid, modality: modalitySchema, source: sourceSchema, environment: environmentSchema, planId: uuid.optional(),
}).strict();
export const completeActivitySchema = z.object({
  activeSeconds: z.number().int().min(0).max(604800),
  distanceMeters: z.number().finite().min(0).max(2000000).optional(),
  steps: z.number().int().min(0).max(1000000).optional(),
  anomalies: z.array(z.enum(['mock_location'])).max(1).optional(),
  notes: z.string().max(2000).optional(), adaptations: z.string().max(2000).optional(),
  clientId: uuid.optional(), totalSeconds: z.number().finite().min(0).max(604800).optional(),
  completed: z.literal(true).optional(), endedAt: z.string().datetime().optional(), completedOffline: z.boolean().optional(),
}).strict();
export const importActivitySchema = z.object({
  clientId: uuid, modality: modalitySchema, source: sourceSchema, environment: environmentSchema,
  startedAt: z.string().datetime(), endedAt: z.string().datetime(),
  activeSeconds: z.number().int().min(0).max(604800),
  distanceMeters: z.number().finite().min(0).max(2000000).optional(),
  steps: z.number().int().min(0).max(1000000).optional(),
  sourceRecordId: z.string().min(1).max(250).optional(),
  totalSeconds: z.number().finite().min(0).max(604800).optional(), completed: z.literal(true).optional(),
  anomalies: z.array(z.enum(['mock_location'])).max(1).optional(),
  notes: z.string().max(2000).optional(), adaptations: z.string().max(2000).optional(),
}).strict();
export type StartActivityInput = z.infer<typeof startActivitySchema>;
export type CompleteActivityInput = z.infer<typeof completeActivitySchema>;
export function activityDto(row: Record<string, any>) {
  return {
    id: row.id as string, clientId: row.client_id as string, userId: row.user_id as string,
    modality: row.modality as string, source: row.source as string, environment: row.environment as string,
    planId: row.plan_id as string | null, status: row.status as string,
    startedAt: iso(row.started_at)!, endedAt: iso(row.ended_at),
    recordedStartAt: iso(row.recorded_start_at), recordedEndAt: iso(row.recorded_end_at),
    activeSeconds: Number(row.active_seconds), distanceMeters: row.distance_meters == null ? null : Number(row.distance_meters),
    steps: row.steps == null ? null : Number(row.steps),
    eligibility: row.eligibility as 'verified' | 'pending_review' | 'ineligible',
    ineligibleReason: row.ineligible_reason as string | null, warnings: row.warnings as string[],
    notes: row.notes as string | null, adaptations: row.adaptations as string | null,
    receivedAt: iso(row.received_at)!, syncStatus: 'confirmed' as const,
    serverTime: iso(row.server_time ?? row.received_at)!,
  };
}
function checkMetrics(input: {modality:string;source:string;environment:string;distanceMeters?:number;steps?:number}): string[] {
  const cardio = ['walking','running','cycling'].includes(input.modality);
  if (input.source === 'gps' && (!cardio || input.environment !== 'outdoor')) throw new ApiError(400,'GPS_OUTDOOR_ONLY','GPS é usado somente em caminhada, corrida e ciclismo ao ar livre.');
  if (input.distanceMeters != null && !cardio) throw new ApiError(400,'DISTANCE_NOT_APPLICABLE','Registre esta modalidade por duração.');
  if (input.steps != null && !['walking','running'].includes(input.modality)) throw new ApiError(400,'STEPS_NOT_APPLICABLE','Passos são opcionais somente para caminhada e corrida.');
  return [];
}
export function detectMetricAnomalies(modality: string, activeSeconds: number, distanceMeters?: number): string[] {
  if (distanceMeters == null || distanceMeters === 0) return [];
  const maximum = modality === 'walking' ? 4.5 : modality === 'running' ? 12 : modality === 'cycling' ? 35 : 0;
  return activeSeconds <= 0 || distanceMeters / activeSeconds > maximum ? ['implausible_speed_requires_review'] : [];
}
async function offlineEligibility(client: import('pg').PoolClient, userId: string) {
  const allowed = await client.query("SELECT 1 FROM challenges c JOIN group_members m ON m.group_id=c.group_id WHERE m.user_id=$1 AND c.rules->>'offlinePolicy'='review' LIMIT 1", [userId]);
  return allowed.rowCount ? 'pending_review' : 'ineligible';
}
export function createActivityService(pool: Pool) {
  return {
    async startActivity(userId: string, raw: StartActivityInput) {
      const input = startActivitySchema.parse(raw);
      checkMetrics(input);
      if (input.source === 'health_connect' || input.source === 'healthkit') throw new ApiError(400,'USE_IMPORT','Use a importação para registros de saúde.');
      return withTransaction(pool, async client => {
        await lockKey(client,'activity-client:' + userId + ':' + input.clientId);
        const existing = await client.query('SELECT *,clock_timestamp() AS server_time FROM activities WHERE user_id=$1 AND client_id=$2', [userId,input.clientId]);
        if (existing.rowCount) {
          const row = existing.rows[0];
          if (row.modality !== input.modality || row.source !== input.source || row.environment !== input.environment || row.plan_id !== (input.planId ?? null)) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Este identificador já pertence a outra sessão.');
          return activityDto(row);
        }
        // A caller cannot claim a plan belonging to another account.
        if (input.planId) {
          const plan = await client.query('SELECT 1 FROM daily_plans WHERE id=$1 AND user_id=$2', [input.planId,userId]);
          if (!plan.rowCount) throw new ApiError(404,'PLAN_NOT_FOUND','Treino não encontrado.');
        }
        const result = await client.query("INSERT INTO activities(user_id,client_id,modality,source,environment,plan_id,status,started_at,server_started,eligibility) VALUES($1,$2,$3,$4,$5,$6,'started',clock_timestamp(),true,'verified') RETURNING *,clock_timestamp() AS server_time", [userId,input.clientId,input.modality,input.source,input.environment,input.planId ?? null]);
        return activityDto(result.rows[0]);
      });
    },
    async completeActivity(userId: string, activityId: string, raw: CompleteActivityInput) {
      const input = completeActivitySchema.parse(raw);
      const fingerprint = hashToken(JSON.stringify({activeSeconds:input.activeSeconds,distanceMeters:input.distanceMeters ?? null,steps:input.steps ?? null,notes:input.notes ?? null,adaptations:input.adaptations ?? null,completedOffline:input.completedOffline ?? false,endedAt:input.completedOffline?(input.endedAt??null):null,anomalies:input.anomalies??[]}));
      return withTransaction(pool, async client => {
        const result = await client.query('SELECT *,clock_timestamp() AS server_time FROM activities WHERE id=$1 AND user_id=$2 FOR NO KEY UPDATE', [activityId,userId]);
        const row = result.rows[0];
        if (!row) throw new ApiError(404,'ACTIVITY_NOT_FOUND','Atividade não encontrada.');
        if (input.clientId && input.clientId !== row.client_id) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador da sessão não corresponde.');
        if (row.status === 'completed') {
          if (row.completion_fingerprint !== fingerprint) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','A conclusão já foi salva com outros dados. Use revisão para corrigir.');
          return activityDto(row);
        }
        checkMetrics({...row,modality:row.modality,source:row.source,environment:row.environment,...input});
        const now = new Date(row.server_time).getTime();
        const start = new Date(row.started_at).getTime();
        const recordedEnd = input.endedAt ? Date.parse(input.endedAt) : now;
        if (recordedEnd < start || recordedEnd > now + 60000) throw new ApiError(400,'INVALID_INTERVAL','O encerramento deve ocorrer depois do início e não pode estar no futuro.');
        const elapsed = (input.completedOffline ? recordedEnd - start : now - start) / 1000;
        if (input.activeSeconds > elapsed + 1) throw new ApiError(400,'ACTIVE_TIME_EXCEEDS_INTERVAL','O tempo ativo não pode superar o tempo transcorrido.');
        const warnings = detectMetricAnomalies(row.modality,input.activeSeconds,input.distanceMeters);
        if(input.anomalies?.includes('mock_location'))warnings.push('mock_location_requires_review');
        let eligibility = input.completedOffline ? await offlineEligibility(client,userId) : 'verified';
        let reason: string | null = input.completedOffline ? 'unverified_offline_completion_time' : null;
        if (warnings.length || now - start > 604800000) { eligibility = 'ineligible'; reason = warnings[0] ?? 'server_session_expired'; }
        const updated = await client.query("UPDATE activities SET status='completed',ended_at=$2,recorded_start_at=CASE WHEN $3 THEN started_at ELSE NULL END,recorded_end_at=CASE WHEN $3 THEN $4::timestamptz ELSE NULL END,active_seconds=$5,distance_meters=$6,steps=$7,notes=$8,adaptations=$9,eligibility=$10,ineligible_reason=$11,warnings=$12,completion_fingerprint=$13,received_at=clock_timestamp() WHERE id=$1 RETURNING *,clock_timestamp() AS server_time", [activityId,new Date(now),input.completedOffline ?? false,new Date(recordedEnd),input.activeSeconds,input.distanceMeters ?? null,input.steps ?? null,input.notes ?? null,input.adaptations ?? null,eligibility,reason,JSON.stringify(warnings),fingerprint]);
        await recomputeUserGroups(client,userId);
        return activityDto(updated.rows[0]);
      });
    },
    async importActivity(userId: string, raw: unknown) {
      const input = importActivitySchema.parse(raw);
      checkMetrics(input);
      const start = Date.parse(input.startedAt), end = Date.parse(input.endedAt);
      if (end < start || end - start > 604800000 || input.activeSeconds > (end-start)/1000 + 1) throw new ApiError(400,'INVALID_INTERVAL','Confira o intervalo e o tempo ativo da atividade.');
      return withTransaction(pool, async client => {
        // Also serializes overlapping records from different health sources.
        await lockKey(client,'activity-import:' + userId);
        const clock = await client.query('SELECT clock_timestamp() AS now');
        if (end > new Date(clock.rows[0].now).getTime() + 60000) throw new ApiError(400,'FUTURE_ACTIVITY','Não é possível importar uma atividade futura.');
        const existing = await client.query('SELECT *,clock_timestamp() AS server_time FROM activities WHERE user_id=$1 AND (client_id=$2 OR (source=$3 AND source_record_id=$4))', [userId,input.clientId,input.source,input.sourceRecordId ?? null]);
        if (existing.rowCount) {
          const row = existing.rows[0];
          if (row.modality !== input.modality || row.source !== input.source || row.environment !== input.environment || Date.parse(iso(row.recorded_start_at) ?? '') !== start || Date.parse(iso(row.recorded_end_at) ?? '') !== end || Number(row.active_seconds) !== input.activeSeconds || Number(row.distance_meters ?? 0) !== (input.distanceMeters ?? 0) || Number(row.steps ?? 0) !== (input.steps ?? 0)) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Este identificador já pertence a outro registro.');
          return activityDto(row);
        }
        const warnings = detectMetricAnomalies(input.modality,input.activeSeconds,input.distanceMeters);
        if(input.anomalies?.includes('mock_location'))warnings.push('mock_location_requires_review');
        const overlap = await client.query("SELECT 1 FROM activities WHERE user_id=$1 AND modality=$2 AND status='completed' AND COALESCE(recorded_start_at,started_at)<$4 AND COALESCE(recorded_end_at,ended_at)>$3 LIMIT 1", [userId,input.modality,input.startedAt,input.endedAt]);
        if (overlap.rowCount) warnings.push('overlapping_interval_requires_review');
        const eligibility = warnings.length ? 'ineligible' : await offlineEligibility(client,userId);
        const result = await client.query("INSERT INTO activities(user_id,client_id,modality,source,environment,status,started_at,ended_at,recorded_start_at,recorded_end_at,server_started,active_seconds,distance_meters,steps,source_record_id,eligibility,ineligible_reason,notes,adaptations,warnings) VALUES($1,$2,$3,$4,$5,'completed',$6,$7,$6,$7,false,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *,clock_timestamp() AS server_time", [userId,input.clientId,input.modality,input.source,input.environment,input.startedAt,input.endedAt,input.activeSeconds,input.distanceMeters ?? null,input.steps ?? null,input.sourceRecordId ?? null,eligibility,warnings[0] ?? 'unverified_import_time',input.notes ?? null,input.adaptations ?? null,JSON.stringify(warnings)]);
        // Untrusted original clocks are preserved, never promoted to verified by this endpoint.
        await recomputeUserGroups(client,userId);
        return activityDto(result.rows[0]);
      });
    },
  };
}
