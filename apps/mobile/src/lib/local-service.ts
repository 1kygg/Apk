import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';
import { localDate, ProfilePreferencesSchema, type ProfilePreferences } from '@consta/domain';
import {
  EXERCISES, EQUIPMENT_LABELS, applySubstitution, generatePlan, getCompatibleSubstitutions, getExercise,
  type DayPlan, type PlanProgress, type TrainingHistorySession,
} from '@consta/training';
import { database, withLocalDatabaseWrite } from './storage';
import { ApiError } from './transport';

type Executor = Pick<SQLiteDatabase, 'runAsync' | 'getFirstAsync' | 'getAllAsync'>;
type LocalProfile = { id: string; displayName: string; avatarUrl?: string | null; createdAt?: string };
type SavedPlan = DayPlan & { status: 'draft' | 'started' | 'completed'; progress: PlanProgress; startedAt?: string; finishedAt?: string; deletedActivity?: boolean };
export type LocalActivitySummary = {
  id: string; clientId: string; userId: string;
  modality: ProfilePreferences['modalities'][number]; source: 'self_reported' | 'gps' | 'manual';
  environment: ProfilePreferences['environment']; planId?: string;
  status: 'started' | 'completed'; startedAt: string; endedAt: string | null;
  activeSeconds: number; totalSeconds: number; distanceMeters?: number; steps?: number;
  notes: string; adaptations: string; anomalies: string[]; warnings: string[];
  eligibility: 'local_only'; syncStatus: 'local_saved'; timeAuthority: 'device';
  receivedAt: string;
};
const profileKey = 'local-profile.v1';
const emptyProgress = (): PlanProgress => ({ sets: {}, adaptations: {}, notes: '' });
const json = (value: unknown) => JSON.stringify(value);
const copy = <T>(value: T): T => JSON.parse(json(value)) as T;
function fail(message: string, code = 'LOCAL_INVALID_INPUT', status = 400): never { throw new ApiError(message, code, status); }
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) fail(result.error.issues.map(issue => issue.message).join(' '));
  return result.data;
}
const idSchema = z.string().uuid();
const environmentSchema = z.enum(['home', 'gym', 'outdoor']);
const modalitySchema = z.enum(['strength', 'walking', 'running', 'cycling', 'football', 'basketball', 'volleyball']);
const sourceSchema = z.enum(['self_reported', 'gps', 'manual']);
const timestamp = z.string().datetime({ offset: true });
const metricsSchema = z.object({
  activeSeconds: z.number().int().min(0).max(604800),
  totalSeconds: z.number().finite().min(0).max(604800).optional(),
  distanceMeters: z.number().finite().min(0).max(2000000).optional(),
  steps: z.number().int().min(0).max(1000000).optional(),
  endedAt: timestamp.optional(), notes: z.string().max(2000).optional(),
  adaptations: z.string().max(2000).optional(),
  anomalies: z.array(z.enum(['mock_location'])).max(1).optional(),
  clientId: idSchema.optional(), completed: z.literal(true).optional(), completedOffline: z.boolean().optional(),
}).strict();
const startSchema = z.object({ clientId: idSchema, modality: modalitySchema, source: sourceSchema, environment: environmentSchema, planId: idSchema.optional() }).strict();
const importSchema = metricsSchema.extend({ clientId: idSchema, modality: modalitySchema, source: sourceSchema, environment: environmentSchema, startedAt: timestamp, endedAt: timestamp }).strict();
const adaptationSchema = z.object({
  exerciseId: z.string().min(1).max(100).optional(), sets: z.number().int().min(1).max(10).optional(),
  repetitions: z.number().int().min(1).max(100).optional(), durationSeconds: z.number().int().min(5).max(7200).optional(),
  restSeconds: z.number().int().min(0).max(600).optional(), note: z.string().max(1000).optional(),
}).strict();
const progressSchema = z.object({ sets: z.record(z.array(z.boolean()).max(10)).optional(), adaptations: z.record(adaptationSchema).optional(), notes: z.string().max(2000).optional() }).strict();
const notificationSchema = z.object({
  enabled: z.boolean(), days: z.array(z.number().int().min(1).max(7)).max(7), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59),
  quietStartMinute: z.number().int().min(0).max(1439), quietEndMinute: z.number().int().min(0).max(1439),
}).strict();
const defaultNotifications = { enabled: false, days: [], hour: 18, minute: 0, quietStartMinute: 1320, quietEndMinute: 420 };

let schemaReady: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();
async function ensureTables(): Promise<SQLiteDatabase> {
  const db = await database();
  if (!schemaReady) {
    schemaReady = db.execAsync(`
      CREATE TABLE IF NOT EXISTS device_preferences(owner_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS device_notifications(owner_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS device_plans(
        id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,local_date TEXT NOT NULL,environment TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft','started','completed')),payload TEXT NOT NULL,
        UNIQUE(owner_id,local_date,environment)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS device_one_started_plan_per_day
        ON device_plans(owner_id,local_date) WHERE status IN ('started','completed');
      CREATE TABLE IF NOT EXISTS device_activity_summaries(
        id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,client_id TEXT NOT NULL,status TEXT NOT NULL,
        started_at TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(owner_id,client_id)
      );
      CREATE INDEX IF NOT EXISTS device_activity_owner ON device_activity_summaries(owner_id,started_at DESC);
    `).catch(error => { schemaReady = null; throw error; });
  }
  await schemaReady;
  return db;
}
async function serialized<T>(action: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  const result = queue.then(() => withLocalDatabaseWrite(async () => action(await ensureTables())));
  queue = result.then(() => undefined, () => undefined);
  return result;
}
async function transaction<T>(db: SQLiteDatabase, action: (tx: Executor) => Promise<T>): Promise<T> {
  const retryDelays = [25, 75, 150];
  for (let attempt = 0; ; attempt++) {
    try {
      let result!: T;
      await db.withExclusiveTransactionAsync(async tx => { result = await action(tx); });
      return result;
    } catch (error) {
      const native = error as { code?: string | number; message?: string } | null;
      const busy = native?.code === 5 || native?.code === 'SQLITE_BUSY'
        || native?.code === 'SQLITE_BUSY_SNAPSHOT'
        || /\bSQLITE_BUSY(?:_SNAPSHOT)?\b|\bdatabase is locked\b/i.test(native?.message ?? '');
      if (!busy || attempt >= retryDelays.length) throw error;
      // Expo rolls the transaction back before rejecting. Retrying local SQL
      // cannot duplicate a completion or repeat an external/native side effect.
      await new Promise<void>(resolve => setTimeout(resolve, retryDelays[attempt]));
    }
  }
}
async function profile(tx: Executor, ownerId: string): Promise<LocalProfile> {
  const row = await tx.getFirstAsync<{ value: string }>('SELECT value FROM local_meta WHERE key=?', profileKey);
  let value: LocalProfile | null = null;
  try { value = row ? JSON.parse(row.value) as LocalProfile : null; } catch { /* Invalid local data is not silently adopted as another profile. */ }
  if (!value || value.id !== ownerId) fail('Este perfil local não está aberto neste aparelho.', 'LOCAL_PROFILE_REQUIRED', 401);
  return value;
}
async function preference(tx: Executor, ownerId: string): Promise<ProfilePreferences> {
  const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM device_preferences WHERE owner_id=?', ownerId);
  if (!row) fail('Defina suas preferências para receber o treino do dia.', 'PREFERENCES_REQUIRED', 404);
  return parse(ProfilePreferencesSchema, JSON.parse(row.payload));
}
async function readPlan(tx: Executor, ownerId: string, id: string): Promise<SavedPlan> {
  const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM device_plans WHERE id=? AND owner_id=?', id, ownerId);
  if (!row) fail('Treino não encontrado neste perfil.', 'PLAN_NOT_FOUND', 404);
  return JSON.parse(row.payload) as SavedPlan;
}
async function putPlan(tx: Executor, ownerId: string, plan: SavedPlan): Promise<void> {
  await tx.runAsync('UPDATE device_plans SET status=?,payload=? WHERE id=? AND owner_id=?', plan.status, json(plan), plan.id, ownerId);
}
async function readActivity(tx: Executor, ownerId: string, id: string): Promise<LocalActivitySummary> {
  const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM device_activity_summaries WHERE id=? AND owner_id=?', id, ownerId);
  if (!row) fail('Atividade não encontrada neste perfil.', 'ACTIVITY_NOT_FOUND', 404);
  return JSON.parse(row.payload) as LocalActivitySummary;
}
async function listActivities(tx: Executor, ownerId: string): Promise<LocalActivitySummary[]> {
  const rows = await tx.getAllAsync<{ payload: string }>('SELECT payload FROM device_activity_summaries WHERE owner_id=? ORDER BY started_at DESC,id DESC', ownerId);
  return rows.map(row => JSON.parse(row.payload) as LocalActivitySummary);
}
async function putActivity(tx: Executor, activity: LocalActivitySummary): Promise<void> {
  await tx.runAsync('INSERT INTO device_activity_summaries(id,owner_id,client_id,status,started_at,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,started_at=excluded.started_at,payload=excluded.payload WHERE device_activity_summaries.owner_id=excluded.owner_id', activity.id, activity.userId, activity.clientId, activity.status, activity.startedAt, json(activity));
}
function checkMetrics(activity: Pick<LocalActivitySummary, 'source' | 'modality' | 'environment'>, metrics: { distanceMeters?: number; steps?: number }): void {
  const cardio = ['walking', 'running', 'cycling'].includes(activity.modality);
  if (activity.source === 'gps' && (!cardio || activity.environment !== 'outdoor')) fail('GPS registra caminhada, corrida ou ciclismo ao ar livre.', 'GPS_OUTDOOR_ONLY');
  if (metrics.distanceMeters !== undefined && !cardio) fail('Registre este esporte por modalidade e duração, sem quilômetros.', 'DISTANCE_NOT_APPLICABLE');
  if (metrics.steps !== undefined && !['walking', 'running'].includes(activity.modality)) fail('Passos são opcionais apenas na caminhada e na corrida.', 'STEPS_NOT_APPLICABLE');
}
function warnings(activity: Pick<LocalActivitySummary, 'source' | 'modality'>, input: z.infer<typeof metricsSchema>): string[] {
  const result: string[] = [];
  if (input.anomalies?.includes('mock_location')) result.push('mock_location');
  const maximum = activity.modality === 'walking' ? 4.5 : activity.modality === 'running' ? 12 : activity.modality === 'cycling' ? 35 : 0;
  if (activity.source === 'gps' && input.distanceMeters && (input.activeSeconds <= 0 || input.distanceMeters / input.activeSeconds > maximum)) result.push('implausible_speed');
  return result;
}
async function startActivity(tx: Executor, ownerId: string, raw: unknown): Promise<LocalActivitySummary> {
  const input = parse(startSchema, raw);
  checkMetrics(input, {});
  const found = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM device_activity_summaries WHERE owner_id=? AND client_id=?', ownerId, input.clientId);
  if (found) {
    const saved = JSON.parse(found.payload) as LocalActivitySummary;
    if (saved.modality !== input.modality || saved.source !== input.source || saved.environment !== input.environment || saved.planId !== input.planId) fail('Este identificador já pertence a outra sessão.', 'IDEMPOTENCY_CONFLICT', 409);
    return saved;
  }
  if (input.planId) await readPlan(tx, ownerId, input.planId);
  const now = new Date().toISOString();
  const activity: LocalActivitySummary = {
    ...input, id: Crypto.randomUUID(), userId: ownerId, status: 'started', startedAt: now, endedAt: null,
    activeSeconds: 0, totalSeconds: 0, notes: '', adaptations: '', anomalies: [], warnings: [],
    eligibility: 'local_only', syncStatus: 'local_saved', timeAuthority: 'device', receivedAt: now,
  };
  await putActivity(tx, activity);
  return activity;
}
function sameCompletion(saved: LocalActivitySummary, input: z.infer<typeof metricsSchema>): boolean {
  return saved.activeSeconds === input.activeSeconds && (saved.distanceMeters ?? null) === (input.distanceMeters ?? null)
    && (saved.steps ?? null) === (input.steps ?? null) && saved.notes === (input.notes ?? '') && saved.adaptations === (input.adaptations ?? '')
    && (input.endedAt === undefined || saved.endedAt === new Date(input.endedAt).toISOString())
    && json(saved.anomalies) === json(input.anomalies ?? []);
}
async function completeActivity(tx: Executor, ownerId: string, id: string, raw: unknown, fromPlan = false): Promise<LocalActivitySummary> {
  const input = parse(metricsSchema, raw);
  const saved = await readActivity(tx, ownerId, id);
  if (saved.planId && !fromPlan) fail('Conclua esta sessão na tela de execução do treino.', 'USE_PLAN_COMPLETION', 409);
  if (input.clientId && input.clientId !== saved.clientId) fail('O identificador não corresponde à atividade.', 'IDEMPOTENCY_CONFLICT', 409);
  if (saved.status === 'completed') {
    if (!sameCompletion(saved, input)) fail('A conclusão já está salva com outros dados.', 'IDEMPOTENCY_CONFLICT', 409);
    return saved;
  }
  checkMetrics(saved, input);
  const end = input.endedAt ? new Date(input.endedAt).toISOString() : new Date().toISOString();
  const elapsed = (Date.parse(end) - Date.parse(saved.startedAt)) / 1000;
  if (elapsed < 0 || input.activeSeconds > elapsed + 1) fail('Confira o horário e a duração: o tempo ativo não pode superar o intervalo registrado no aparelho.', 'INVALID_INTERVAL');
  const completed: LocalActivitySummary = {
    ...saved, ...input, endedAt: end, status: 'completed',
    totalSeconds: input.totalSeconds ?? Math.max(input.activeSeconds, elapsed),
    notes: input.notes ?? '', adaptations: input.adaptations ?? '', anomalies: input.anomalies ?? [], warnings: warnings(saved, input),
    eligibility: 'local_only', syncStatus: 'local_saved', timeAuthority: 'device', receivedAt: new Date().toISOString(),
  };
  // Deliberately do not retain transport-only fields such as completedOffline:
  // this version has no synchronization service or authoritative server clock.
  const { clientId: _clientId, completedOffline: _offline, completed: _done, ...clean } = completed as LocalActivitySummary & z.infer<typeof metricsSchema>;
  const result = { ...clean, clientId: saved.clientId } as LocalActivitySummary;
  await putActivity(tx, result);
  return result;
}
async function importActivity(tx: Executor, ownerId: string, raw: unknown): Promise<LocalActivitySummary> {
  const input = parse(importSchema, raw);
  checkMetrics(input, input);
  const elapsed = (Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000;
  if (elapsed < 0 || elapsed > 604800 || input.activeSeconds > elapsed + 1) fail('Confira os horários e a duração informados no aparelho.', 'INVALID_INTERVAL');
  const found = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM device_activity_summaries WHERE owner_id=? AND client_id=?', ownerId, input.clientId);
  if (found) {
    const saved = JSON.parse(found.payload) as LocalActivitySummary;
    if (saved.modality !== input.modality || saved.source !== input.source || saved.environment !== input.environment) fail('Este identificador já pertence a outra atividade.', 'IDEMPOTENCY_CONFLICT', 409);
    if (saved.status === 'completed') {
      if (saved.startedAt !== new Date(input.startedAt).toISOString() || !sameCompletion(saved, input)) fail('O registro já está salvo com outros dados.', 'IDEMPOTENCY_CONFLICT', 409);
      return saved;
    }
    // Preserve the recorded device start if the process stopped after committing
    // its first local row but before receiving the in-process acknowledgement.
    const recovery = { ...saved, startedAt: new Date(input.startedAt).toISOString() };
    await putActivity(tx, recovery);
    return completeActivity(tx, ownerId, saved.id, {
      activeSeconds: input.activeSeconds, totalSeconds: input.totalSeconds, distanceMeters: input.distanceMeters,
      steps: input.steps, endedAt: input.endedAt, notes: input.notes, adaptations: input.adaptations, anomalies: input.anomalies,
    });
  }
  const now = new Date().toISOString();
  const activity: LocalActivitySummary = {
    id: Crypto.randomUUID(), clientId: input.clientId, userId: ownerId, modality: input.modality, source: input.source, environment: input.environment,
    status: 'completed', startedAt: new Date(input.startedAt).toISOString(), endedAt: new Date(input.endedAt).toISOString(),
    activeSeconds: input.activeSeconds, totalSeconds: input.totalSeconds ?? elapsed,
    ...(input.distanceMeters === undefined ? {} : { distanceMeters: input.distanceMeters }),
    ...(input.steps === undefined ? {} : { steps: input.steps }),
    notes: input.notes ?? '', adaptations: input.adaptations ?? '', anomalies: input.anomalies ?? [], warnings: warnings(input, input),
    eligibility: 'local_only', syncStatus: 'local_saved', timeAuthority: 'device', receivedAt: now,
  };
  await putActivity(tx, activity);
  return activity;
}
function mergeProgress(plan: SavedPlan, patch: z.infer<typeof progressSchema>, preferences: ProfilePreferences): PlanProgress {
  const progress = { sets: { ...plan.progress.sets, ...patch.sets }, adaptations: { ...plan.progress.adaptations, ...patch.adaptations }, notes: patch.notes ?? plan.progress.notes };
  const original = plan.startedSnapshot ?? plan;
  const profile = { ...preferences, environment: plan.environment };
  for (const [slot, adaptation] of Object.entries(progress.adaptations)) {
    const exercise = original.exercises.find(item => item.id === slot);
    if (!exercise) fail('A adaptação deve pertencer a uma etapa desta sessão.', 'INVALID_ADAPTATION');
    if (adaptation.sets !== undefined && adaptation.sets > exercise.sets) fail('Use a adaptação para reduzir séries, preservando a sugestão original.', 'INVALID_ADAPTATION');
    if (adaptation.exerciseId && adaptation.exerciseId !== exercise.exerciseId && !getCompatibleSubstitutions(profile, exercise.exerciseId).some(item => item.id === adaptation.exerciseId)) fail('Escolha uma alternativa compatível com seu nível, ambiente e materiais.', 'INVALID_ADAPTATION');
  }
  for (const [slot, sets] of Object.entries(progress.sets)) {
    const exercise = original.exercises.find(item => item.id === slot);
    if (!exercise || sets.length > exercise.sets) fail('Marque apenas séries desta sessão.', 'INVALID_SETS');
  }
  return progress;
}
async function recentHistory(tx: Executor, ownerId: string): Promise<TrainingHistorySession[]> {
  const rows = await tx.getAllAsync<{ payload: string }>("SELECT payload FROM device_plans WHERE owner_id=? AND status='completed' ORDER BY local_date DESC LIMIT 50", ownerId);
  const cutoff = Date.now() - 21 * 86400000;
  const plans: TrainingHistorySession[] = rows.map(row => JSON.parse(row.payload) as SavedPlan).filter(plan => !plan.deletedActivity && plan.finishedAt && Date.parse(plan.finishedAt) >= cutoff).map(plan => ({
    completedAt: plan.finishedAt!, exerciseIds: plan.exercises.map(exercise => plan.progress.adaptations[exercise.id]?.exerciseId ?? exercise.exerciseId), intensity: 'moderate' as const,
  }));
  const otherSessions: TrainingHistorySession[] = (await listActivities(tx, ownerId)).filter(activity => !activity.planId && activity.status === 'completed' && activity.endedAt && Date.parse(activity.endedAt) >= cutoff).map(activity => ({
    completedAt: activity.endedAt!, exerciseIds: [],
    recoveryGroups: ['running', 'cycling', 'football', 'basketball', 'volleyball'].includes(activity.modality) ? ['quadriceps', 'posterior', 'calves'] : undefined,
    intensity: activity.modality === 'walking' ? 'easy' : 'moderate',
  }));
  return [...plans, ...otherSessions].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 50);
}

async function dispatch(tx: Executor, ownerId: string, path: string, method: string, body: unknown): Promise<unknown> {
  const me = await profile(tx, ownerId);
  const [pathname = '', search] = path.replace(/^\/v1(?=\/)/, '').split('?');
  const route = pathname.startsWith('/') ? pathname : '/' + pathname;
  if (route === '/me' && method === 'GET') {
    const hasPreferences = await tx.getFirstAsync('SELECT owner_id FROM device_preferences WHERE owner_id=?', ownerId);
    return { ...me, onboardingComplete: !!hasPreferences, profileType: 'local' };
  }
  if (route === '/me' && method === 'PATCH') {
    const input = parse(z.object({
      displayName: z.string().trim().min(1).max(80).optional(),
      avatarUrl: z.string().max(500000).refine(value => /^file:\/\/|^content:\/\/|^data:image\/(?:jpeg|png);base64,/.test(value), 'Escolha uma foto armazenada no aparelho.').nullable().optional(),
    }).strict(), body);
    const updated = { ...me, ...input };
    await tx.runAsync('UPDATE local_meta SET value=? WHERE key=?', json(updated), profileKey);
    return { ...updated, profileType: 'local' };
  }
  if (route === '/me/avatar' && method === 'POST') {
    const input = parse(z.object({ base64: z.string().min(8).max(410000).regex(/^[A-Za-z0-9+/]+={0,2}$/), mimeType: z.enum(['image/jpeg', 'image/png']) }).strict(), body);
    const avatarUrl = 'data:' + input.mimeType + ';base64,' + input.base64;
    await tx.runAsync('UPDATE local_meta SET value=? WHERE key=?', json({ ...me, avatarUrl }), profileKey);
    return { ...me, avatarUrl, profileType: 'local' };
  }
  if (route === '/me/preferences') {
    if (method === 'GET') return preference(tx, ownerId);
    if (method === 'PATCH') {
      const value = parse(ProfilePreferencesSchema, body);
      await tx.runAsync('INSERT INTO device_preferences(owner_id,payload) VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload', ownerId, json(value));
      return value;
    }
  }
  if (route === '/me/notifications') {
    if (method === 'GET') {
      const row = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM device_notifications WHERE owner_id=?', ownerId);
      return row ? JSON.parse(row.payload) : defaultNotifications;
    }
    if (method === 'PATCH') {
      const value = parse(notificationSchema, body);
      await tx.runAsync('INSERT INTO device_notifications(owner_id,payload) VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload', ownerId, json(value));
      return value;
    }
  }
  if (route === '/exercises' && method === 'GET') return { exercises: EXERCISES, equipment: EQUIPMENT_LABELS };
  if (route === '/notifications' && method === 'GET') return { items: [] };
  if (route === '/activities' && method === 'GET') return { items: await listActivities(tx, ownerId), authority: 'device' };
  if (route === '/activities/start' && method === 'POST') return startActivity(tx, ownerId, body);
  if (route === '/activities/import' && method === 'POST') return importActivity(tx, ownerId, body);
  const activityRoute = route.match(/^\/activities\/([^/]+)(?:\/(complete))?$/);
  if (activityRoute) {
    const id = parse(idSchema, activityRoute[1]);
    if (activityRoute[2] === 'complete' && method === 'POST') return completeActivity(tx, ownerId, id, body);
    if (!activityRoute[2] && method === 'GET') return readActivity(tx, ownerId, id);
    if (!activityRoute[2] && method === 'DELETE') {
      const activity = await readActivity(tx, ownerId, id);
      if (activity.planId) {
        const plan = await readPlan(tx, ownerId, activity.planId);
        plan.status = 'completed'; plan.finishedAt ??= new Date().toISOString(); plan.deletedActivity = true;
        plan.activityId = undefined; plan.progress = emptyProgress();
        await putPlan(tx, ownerId, plan);
      }
      await tx.runAsync('DELETE FROM device_activity_summaries WHERE id=? AND owner_id=?', id, ownerId);
      return { deleted: true, authority: 'device' };
    }
  }
  if (route === '/plans/today' && method === 'GET') {
    const preferences = await preference(tx, ownerId);
    const environmentValue = new URLSearchParams(search ?? '').get('environment');
    const environment = environmentValue ? parse(environmentSchema, environmentValue) : preferences.environment;
    const date = localDate(new Date().toISOString(), preferences.timezone);
    const begun = await tx.getFirstAsync<{ payload: string }>("SELECT payload FROM device_plans WHERE owner_id=? AND local_date=? AND status IN ('started','completed') LIMIT 1", ownerId, date);
    if (begun) {
      const plan = JSON.parse(begun.payload) as SavedPlan;
      if (environmentValue && plan.environment !== environment) fail('A sessão do dia já começou. Continue sua versão salva.', 'ENVIRONMENT_LOCKED', 409);
      return plan;
    }
    const previous = await tx.getFirstAsync<{ payload: string }>('SELECT payload FROM device_plans WHERE owner_id=? AND local_date=? AND environment=?', ownerId, date, environment);
    if (previous) return JSON.parse(previous.payload);
    const plan: SavedPlan = { ...generatePlan({ ...preferences, environment }, date, await recentHistory(tx, ownerId)), id: Crypto.randomUUID(), status: 'draft', progress: emptyProgress() };
    await tx.runAsync('INSERT INTO device_plans(id,owner_id,local_date,environment,status,payload) VALUES(?,?,?,?,?,?)', plan.id, ownerId, date, environment, plan.status, json(plan));
    return plan;
  }
  const planRoute = route.match(/^\/plans\/([^/]+)\/(start|substitute|progress|finish)$/);
  if (planRoute) {
    const id = parse(idSchema, planRoute[1]);
    const action = planRoute[2];
    const plan = await readPlan(tx, ownerId, id);
    const preferences = await preference(tx, ownerId);
    if (action === 'substitute' && method === 'POST') {
      if (plan.status !== 'draft') fail('A sessão já começou. Use as adaptações para preservar o original.', 'PLAN_STARTED', 409);
      const input = parse(z.object({ exerciseId: z.string().min(1), replacementId: z.string().min(1) }).strict(), body);
      let next: SavedPlan;
      try { next = applySubstitution(plan, input.exerciseId, input.replacementId, { ...preferences, environment: plan.environment }) as SavedPlan; }
      catch (error) { fail(error instanceof Error ? error.message : 'Substituição incompatível.', 'INVALID_SUBSTITUTION'); }
      await putPlan(tx, ownerId, next);
      return next;
    }
    if (action === 'start' && method === 'POST') {
      parse(z.object({ clientId: idSchema }).strict(), body);
      if (plan.status !== 'draft') return { plan, activity: plan.activityId ? await readActivity(tx, ownerId, plan.activityId) : null };
      if (plan.kind === 'rest') fail('Esta sugestão é de descanso, sem sessão para pontuar.', 'REST_DAY', 409);
      if (plan.date !== localDate(new Date().toISOString(), preferences.timezone)) fail('Inicie a sugestão do dia atual. O histórico permanece salvo.', 'PAST_PLAN', 409);
      const other = await tx.getFirstAsync("SELECT id FROM device_plans WHERE owner_id=? AND local_date=? AND status IN ('started','completed') AND id<>?", ownerId, plan.date, plan.id);
      if (other) fail('Você já iniciou uma sessão para hoje. Continue seu progresso salvo.', 'DAILY_SESSION_EXISTS', 409);
      plan.startedSnapshot = copy(plan); plan.startedAt = new Date().toISOString(); plan.status = 'started';
      const activity = await startActivity(tx, ownerId, { clientId: plan.id, modality: getExercise(plan.exercises[0]?.exerciseId ?? '')?.modality ?? 'strength', source: 'self_reported', environment: plan.environment, planId: plan.id });
      plan.activityId = activity.id;
      await putPlan(tx, ownerId, plan);
      return { plan, activity };
    }
    if (action === 'progress' && method === 'PATCH') {
      const patch = parse(progressSchema, body);
      const next = mergeProgress(plan, patch, preferences);
      if (plan.status === 'completed') {
        if (json(next) !== json(plan.progress)) fail('A sessão já está concluída. Seu histórico foi preservado.', 'SESSION_COMPLETED', 409);
        return plan;
      }
      if (plan.status !== 'started') fail('Inicie a sessão antes de marcar séries.', 'SESSION_NOT_STARTED', 409);
      plan.progress = next;
      await putPlan(tx, ownerId, plan);
      return plan;
    }
    if (action === 'finish' && method === 'POST') {
      if (plan.status === 'draft') fail('Inicie a sessão antes de concluir.', 'SESSION_NOT_STARTED', 409);
      if (plan.status === 'completed') return { plan, activity: plan.activityId ? await readActivity(tx, ownerId, plan.activityId) : null };
      const input = parse(z.object({ activeSeconds: z.number().int().min(0).max(604800).optional(), notes: z.string().max(2000).optional(), adaptations: z.record(adaptationSchema).optional(), endedAt: timestamp.optional(), completedOffline: z.boolean().optional() }).strict(), body);
      plan.progress = mergeProgress(plan, { notes: input.notes, adaptations: input.adaptations }, preferences);
      const end = input.endedAt ?? new Date().toISOString();
      const activity = await readActivity(tx, ownerId, plan.activityId!);
      const elapsed = Math.max(0, Math.floor((Date.parse(end) - Date.parse(activity.startedAt)) / 1000));
      const finished = await completeActivity(tx, ownerId, activity.id, {
        activeSeconds: input.activeSeconds ?? elapsed, endedAt: end, notes: plan.progress.notes,
        adaptations: Object.entries(plan.progress.adaptations).map(([slot, value]) => slot + ': ' + json(value)).join('; ').slice(0, 2000),
      }, true);
      plan.status = 'completed'; plan.finishedAt = finished.endedAt!;
      await putPlan(tx, ownerId, plan);
      return { plan, activity: finished };
    }
  }
  fail('Esta função não está disponível no perfil local. Não existe sincronização online nesta versão.', 'LOCAL_ROUTE_UNAVAILABLE', 404);
}

/** SQLite-only service. It never authenticates over the network or calls fetch. */
export async function localRequest<T>(ownerId: string, path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!ownerId) fail('Crie ou abra seu perfil local.', 'LOCAL_PROFILE_REQUIRED', 401);
  return serialized(db => transaction(db, tx => dispatch(tx, ownerId, path, (options.method ?? 'GET').toUpperCase(), options.body))).then(value => copy(value) as T);
}

/** Called by local profile deletion; does not touch another profile's history. */
export async function deleteLocalServiceData(ownerId: string): Promise<void> {
  await serialized(db => transaction(db, async tx => {
    await tx.runAsync('DELETE FROM device_activity_summaries WHERE owner_id=?', ownerId);
    await tx.runAsync('DELETE FROM device_plans WHERE owner_id=?', ownerId);
    await tx.runAsync('DELETE FROM device_preferences WHERE owner_id=?', ownerId);
    await tx.runAsync('DELETE FROM device_notifications WHERE owner_id=?', ownerId);
    await tx.runAsync('DELETE FROM local_meta WHERE key=?', 'local-score-rules.' + ownerId);
  }));
}
