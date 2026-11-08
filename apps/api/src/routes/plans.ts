import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { localDate, ProfilePreferencesSchema, type ProfilePreferences } from "@consta/domain";
import { EXERCISES, EQUIPMENT_LABELS, applySubstitution, generatePlan, getCompatibleSubstitutions, getExercise, type DayPlan, type ExerciseAdaptation, type PlanProgress, type TrainingEnvironment, type TrainingHistorySession } from "@consta/training";

type ActivityInput = { clientId: string; modality: ProfilePreferences["modalities"][number]; source: "self_reported"; environment: TrainingEnvironment; planId: string };
export interface PlanRouteOptions {
  pool: Pool;
  authenticate: preHandlerHookHandler;
  startActivity: (userId: string, input: ActivityInput) => Promise<{ id: string }>;
  completeActivity: (userId: string, activityId: string, input: { activeSeconds: number; notes?: string; adaptations?: string }) => Promise<{ id: string }>;
}
interface PlanRow {
  id: string; user_id: string; local_date: Date | string; environment: TrainingEnvironment;
  payload: DayPlan; status: "draft" | "started" | "completed"; activity_id: string | null;
  started_snapshot: DayPlan | null; progress: PlanProgress;
  started_at: Date | string | null; finished_at: Date | string | null;
}
const environmentSchema = z.enum(["home","gym","outdoor"]);
const idSchema = z.object({ id: z.string().uuid() });
const adaptationSchema = z.object({
  exerciseId: z.string().min(1).max(100).optional(),
  sets: z.number().int().min(1).max(10).optional(),
  repetitions: z.number().int().min(1).max(100).optional(),
  durationSeconds: z.number().int().min(5).max(7200).optional(),
  restSeconds: z.number().int().min(0).max(600).optional(),
  note: z.string().max(1000).optional()
}).strict();
const progressSchema = z.object({
  sets: z.record(z.array(z.boolean()).max(10)).optional(),
  adaptations: z.record(adaptationSchema).optional(),
  notes: z.string().max(2000).optional()
}).strict();
const finishSchema = z.object({
  activeSeconds: z.number().int().min(0).max(86400).optional(),
  notes: z.string().max(2000).optional(),
  adaptations: z.record(adaptationSchema).optional()
}).strict();
function fail(statusCode: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { statusCode, code });
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) fail(400, "invalid_input", result.error.issues.map(issue => issue.path.join(".") + ": " + issue.message).join("; "));
  return result.data;
}
function userId(request: FastifyRequest): string { return (request as FastifyRequest & { user: { id: string } }).user.id; }
function dto(row: PlanRow): DayPlan {
  return { ...row.payload, id: row.id, status: row.status, activityId: row.activity_id ?? undefined,
    progress: row.progress, startedSnapshot: row.started_snapshot ?? undefined };
}
async function preferences(pool: Pool, uid: string): Promise<ProfilePreferences> {
  const result = await pool.query<{ payload: unknown }>("SELECT payload FROM user_preferences WHERE user_id=$1", [uid]);
  const parsed = ProfilePreferencesSchema.safeParse(result.rows[0]?.payload);
  if (!parsed.success) fail(428, "onboarding_required", "Defina suas preferências antes de gerar uma sessão.");
  return parsed.data;
}
async function owned(client: Pool | PoolClient, uid: string, id: string, lock = false): Promise<PlanRow> {
  const result = await client.query<PlanRow>("SELECT * FROM daily_plans WHERE id=$1 AND user_id=$2" + (lock ? " FOR UPDATE" : ""), [id,uid]);
  if (!result.rows[0]) fail(404, "plan_not_found", "Sessão não encontrada.");
  return result.rows[0];
}
async function locked<T>(pool: Pool, uid: string, id: string, operation: (client: PoolClient,row: PlanRow)=>Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await owned(client,uid,id,true);
    const result = await operation(client,row);
    await client.query("COMMIT");
    return result;
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function event(client: PoolClient, row: PlanRow, kind: string, payload: unknown): Promise<void> {
  await client.query("INSERT INTO daily_plan_events(id,plan_id,user_id,kind,payload) VALUES($1,$2,$3,$4,$5::jsonb)", [randomUUID(),row.id,row.user_id,kind,JSON.stringify(payload)]);
}
async function recentSessions(pool: Pool, uid: string): Promise<TrainingHistorySession[]> {
  const result = await pool.query<{
    ended_at: Date | string; modality: string; payload: DayPlan | null; started_snapshot: DayPlan | null; progress: PlanProgress | null;
  }>("SELECT a.ended_at,a.modality,p.payload,p.started_snapshot,p.progress FROM activities a LEFT JOIN daily_plans p ON p.activity_id=a.id WHERE a.user_id=$1 AND a.status='completed' AND a.ended_at > clock_timestamp()-interval '21 days' ORDER BY a.ended_at DESC LIMIT 50", [uid]);
  return result.rows.map(row => {
    const plan = row.started_snapshot ?? row.payload;
    const exerciseIds = plan?.exercises.map(exercise => row.progress?.adaptations?.[exercise.id]?.exerciseId ?? exercise.exerciseId) ?? [];
    const lowerBody = ["running","cycling","football","basketball","volleyball"].includes(row.modality);
    return {
      completedAt: new Date(row.ended_at).toISOString(), exerciseIds,
      recoveryGroups: lowerBody ? ["quadriceps","posterior","calves"] : undefined,
      intensity: row.modality === "walking" ? "easy" : "moderate"
    } as TrainingHistorySession;
  });
}
function mergeProgress(row: PlanRow, patch: z.infer<typeof progressSchema>, profile: ProfilePreferences): PlanProgress {
  const snapshot = row.started_snapshot ?? row.payload;
  const progress: PlanProgress = {
    sets: { ...(row.progress?.sets ?? {}), ...(patch.sets ?? {}) },
    adaptations: { ...(row.progress?.adaptations ?? {}), ...(patch.adaptations ?? {}) },
    notes: patch.notes ?? row.progress?.notes ?? ""
  };
  const scoped = { ...profile, environment: row.environment };
  const slots = new Map(snapshot.exercises.map(exercise => [exercise.id,exercise]));
  for (const [slot,adaptation] of Object.entries(progress.adaptations)) {
    const original = slots.get(slot);
    if (!original) fail(422,"unknown_exercise_slot","A adaptação deve se referir a uma etapa desta sessão.");
    if (adaptation.sets !== undefined && adaptation.sets > original.sets) fail(422,"incompatible_adaptation","Use a adaptação para reduzir séries. A sugestão original permanece no histórico.");
    if (adaptation.exerciseId && adaptation.exerciseId !== original.exerciseId) {
      const compatible = getCompatibleSubstitutions(scoped,original.exerciseId).some(candidate => candidate.id === adaptation.exerciseId);
      if (!compatible) fail(422,"incompatible_adaptation","Escolha uma alternativa compatível com o movimento, nível e materiais.");
    }
  }
  for (const [slot,sets] of Object.entries(progress.sets)) {
    const original = slots.get(slot);
    if (!original || sets.length > original.sets) fail(422,"invalid_sets","As séries marcadas devem pertencer à sessão original.");
  }
  return progress;
}
function activityInput(row: PlanRow): ActivityInput {
  const snapshot = row.started_snapshot ?? row.payload;
  return { clientId: row.id, modality: getExercise(snapshot.exercises[0]?.exerciseId ?? "")?.modality ?? "strength",
    source: "self_reported", environment: row.environment, planId: row.id };
}
async function connectActivity(options: PlanRouteOptions, row: PlanRow): Promise<{ row: PlanRow; activity: {id:string} }> {
  // Canonical idempotency key is the server plan UUID. A different request/client
  // ID, screen reopening, substitution or retry cannot create another activity.
  const activity = await options.startActivity(row.user_id,activityInput(row));
  await options.pool.query("UPDATE daily_plans SET activity_id=$1 WHERE id=$2 AND user_id=$3 AND activity_id IS NULL", [activity.id,row.id,row.user_id]);
  return { row: await owned(options.pool,row.user_id,row.id), activity };
}
export async function registerPlanRoutes(app: FastifyInstance, options: PlanRouteOptions): Promise<void> {
  const { pool,authenticate } = options;
  app.get("/v1/exercises",{preHandler:authenticate},async () => ({ exercises: EXERCISES, equipment: EQUIPMENT_LABELS }));

  app.get("/v1/plans/today",{preHandler:authenticate},async request => {
    const uid = userId(request);
    const profile = await preferences(pool,uid);
    const query = parse(z.object({environment:environmentSchema.optional()}).strict(),request.query);
    const clock = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const date = localDate(new Date(clock.rows[0]!.now).toISOString(),profile.timezone);
    const active = await pool.query<PlanRow>("SELECT * FROM daily_plans WHERE user_id=$1 AND local_date=$2::date AND status IN ('started','completed') LIMIT 1", [uid,date]);
    if (active.rows[0]) {
      if (query.environment && query.environment !== active.rows[0].environment) fail(409,"environment_locked","A sessão de hoje já começou. Seu ambiente e sua versão original estão preservados.");
      return dto(active.rows[0]);
    }
    const environment = query.environment ?? profile.environment;
    const existing = await pool.query<PlanRow>("SELECT * FROM daily_plans WHERE user_id=$1 AND local_date=$2::date AND environment=$3",[uid,date,environment]);
    if (existing.rows[0]) return dto(existing.rows[0]);
    const plan = generatePlan({...profile,environment},date,await recentSessions(pool,uid));
    plan.id = randomUUID();
    const inserted = await pool.query<PlanRow>(
      "INSERT INTO daily_plans(id,user_id,local_date,environment,payload) VALUES($1,$2,$3::date,$4,$5::jsonb) ON CONFLICT(user_id,local_date,environment) DO NOTHING RETURNING *",
      [plan.id,uid,date,environment,JSON.stringify(plan)]);
    const row = inserted.rows[0] ?? (await pool.query<PlanRow>("SELECT * FROM daily_plans WHERE user_id=$1 AND local_date=$2::date AND environment=$3",[uid,date,environment])).rows[0]!;
    return dto(row);
  });

  app.post("/v1/plans/:id/substitute",{preHandler:authenticate},async request => {
    const uid = userId(request), {id} = parse(idSchema,request.params);
    const body = parse(z.object({exerciseId:z.string().min(1).max(100),replacementId:z.string().min(1).max(100)}).strict(),request.body);
    const profile = await preferences(pool,uid);
    return locked(pool,uid,id,async (client,row) => {
      if (row.status !== "draft") fail(409,"plan_started","Após iniciar, use as adaptações de execução. A versão original é preservada.");
      let next: DayPlan;
      try { next = applySubstitution(dto(row),body.exerciseId,body.replacementId,profile); }
      catch(error) { fail(422,"incompatible_substitution",error instanceof Error ? error.message : "Alternativa incompatível."); }
      const {status:_status,activityId:_activityId,progress:_progress,startedSnapshot:_snapshot,...payload} = next;
      const result = await client.query<PlanRow>("UPDATE daily_plans SET payload=$1::jsonb WHERE id=$2 RETURNING *",[JSON.stringify(payload),id]);
      await event(client,row,"substituted",body);
      return dto(result.rows[0]!);
    });
  });

  app.post("/v1/plans/:id/start",{preHandler:authenticate},async request => {
    const uid = userId(request), {id} = parse(idSchema,request.params);
    parse(z.object({clientId:z.string().uuid()}).strict(),request.body);
    const profile = await preferences(pool,uid);
    let row = await locked(pool,uid,id,async (client,current) => {
      if (current.status !== "draft") return current;
      if (current.payload.kind === "rest") fail(409,"rest_day","Esta é uma sugestão de recuperação, sem sessão para pontuar.");
      const clock = await client.query<{now:Date}>("SELECT clock_timestamp() AS now");
      const date = localDate(new Date(clock.rows[0]!.now).toISOString(),profile.timezone);
      if (current.payload.date !== date) fail(409,"past_plan","Inicie a sugestão do dia atual. O histórico anterior é preservado.");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["training:" + uid + ":" + date]);
      const other = await client.query("SELECT id FROM daily_plans WHERE user_id=$1 AND local_date=$2::date AND status IN ('started','completed') AND id<>$3",[uid,date,id]);
      if (other.rowCount) fail(409,"session_already_started","Você já iniciou uma sessão para hoje. Continue a versão salva.");
      const updated = await client.query<PlanRow>("UPDATE daily_plans SET status='started',started_at=clock_timestamp(),started_snapshot=payload WHERE id=$1 RETURNING *",[id]);
      await event(client,current,"started",{version:1,completion:"self_reported_or_adapted"});
      return updated.rows[0]!;
    });
    if (row.status === "completed" && !row.activity_id) return {plan:dto(row),activity:null};
    const result = await connectActivity(options,row); row = result.row;
    return {plan:dto(row),activity:result.activity};
  });

  app.patch("/v1/plans/:id/progress",{preHandler:authenticate},async request => {
    const uid = userId(request), {id} = parse(idSchema,request.params);
    const body = parse(progressSchema,request.body);
    const profile = await preferences(pool,uid);
    return locked(pool,uid,id,async (client,row) => {
      if (row.status !== "started") fail(409,"session_not_active","Inicie a sessão antes de marcar séries; sessões concluídas preservam o histórico.");
      const progress = mergeProgress(row,body,profile);
      const updated = await client.query<PlanRow>("UPDATE daily_plans SET progress=$1::jsonb WHERE id=$2 RETURNING *",[JSON.stringify(progress),id]);
      await event(client,row,"progress",{sets:body.sets,adaptations:body.adaptations,notesChanged:body.notes !== undefined});
      return dto(updated.rows[0]!);
    });
  });

  app.post("/v1/plans/:id/finish",{preHandler:authenticate},async request => {
    const uid = userId(request), {id} = parse(idSchema,request.params);
    const body = parse(finishSchema,request.body);
    const profile = await preferences(pool,uid);
    let row = await locked(pool,uid,id,async (client,current) => {
      if (current.status === "draft") fail(409,"session_not_started","Inicie a sessão antes de concluir.");
      if (current.status === "completed") return current;
      const progress = mergeProgress(current,{adaptations:body.adaptations,notes:body.notes},profile);
      const updated = await client.query<PlanRow>("UPDATE daily_plans SET progress=$1::jsonb WHERE id=$2 RETURNING *",[JSON.stringify(progress),id]);
      return updated.rows[0]!;
    });
    if (row.status === "completed" && !row.activity_id) return {plan:dto(row),activity:null};
    // Recovery after process/network interruption uses the same server-issued ID.
    if (!row.activity_id) row = (await connectActivity(options,row)).row;
    const elapsed = row.started_at ? Math.max(0,Math.floor((Date.now()-new Date(row.started_at).getTime())/1000)) : 0;
    const adaptations = Object.entries(row.progress.adaptations).map(([slot,value]) => slot + ": " + JSON.stringify(value)).join("; ").slice(0,2000);
    const activity = await options.completeActivity(uid,row.activity_id!,{activeSeconds:body.activeSeconds ?? Math.min(elapsed,86400),notes:row.progress.notes,adaptations});
    row = await locked(pool,uid,id,async (client,current) => {
      if (current.status === "completed") return current;
      const updated = await client.query<PlanRow>("UPDATE daily_plans SET status='completed',finished_at=clock_timestamp() WHERE id=$1 RETURNING *",[id]);
      await event(client,current,"completed",{activityId:activity.id,completion:"self_reported_or_adapted"});
      return updated.rows[0]!;
    });
    return {plan:dto(row),activity};
  });
}
