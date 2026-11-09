import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';

// A real PostgreSQL transaction test. The injected verifier is limited to this
// factory instance; no OAuth endpoint or real provider is claimed verified here.
const dbDescribe = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
dbDescribe('daily plan persistence, immutable execution and completion retries', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let authorization: string;
  let userId: string;
  const profile = {
    goal: 'health', level: 'beginner', availableDays: [1,2,3,4,5,6,7],
    durationMinutes: 25, environment: 'home', equipment: [],
    modalities: ['strength'], avoidExerciseIds: [], timezone: 'America/Sao_Paulo',
  };
  beforeAll(async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    if (!connectionString) throw new Error('TEST_DATABASE_URL is required for database tests.');
    const databaseName = new URL(connectionString).pathname;
    if (!/test/i.test(databaseName)) throw new Error('Use a dedicated test database.');
    pool = new Pool({connectionString, max: 10});
    await migrate(pool);
    app = await buildApp({pool, config: {
      jwtSecret: 'training-tests-only-signing-key-longer-than-32-bytes',
      googleClientIds: ['test-client.apps.googleusercontent.com'], appleClientIds: [],
      issuer: 'consta-api', audience: 'consta-native',
    }, verifyIdentity: async (_provider, token) => ({sub: token, displayName: 'Pessoa de teste'})});
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users CASCADE');
    const login = await app.inject({method: 'POST', url: '/v1/auth/google', payload: {idToken: randomUUID()}});
    expect(login.statusCode).toBe(200);
    const session = login.json(); userId = session.user.id; authorization = 'Bearer ' + session.accessToken;
    const response = await app.inject({method: 'PATCH', url: '/v1/me/preferences', headers: {authorization}, payload: profile});
    expect(response.statusCode).toBe(200);
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  async function today(environment = 'home') {
    const response = await app.inject({method: 'GET', url: '/v1/plans/today?environment=' + environment, headers: {authorization}});
    expect(response.statusCode).toBe(200);
    return response.json();
  }
  async function start(id: string) {
    const response = await app.inject({method: 'POST', url: '/v1/plans/' + id + '/start', headers: {authorization}, payload: {clientId: randomUUID()}});
    expect(response.statusCode).toBe(200);
    return response.json();
  }
  it('registers one /v1 prefix and returns the saved suggestion across openings', async () => {
    const first = await today(); const reopened = await today();
    expect(first.kind).toBe('training'); expect(first.exercises.length).toBeGreaterThan(0);
    expect(reopened).toEqual(first);
    const result = await pool.query('SELECT count(*) FROM daily_plans WHERE user_id=$1', [userId]);
    expect(result.rows[0].count).toBe('1');
    const library = await app.inject({url: '/v1/exercises', headers: {authorization}});
    expect(library.statusCode).toBe(200); expect(library.json().exercises.length).toBeGreaterThan(30);
    expect((await app.inject({url: '/v1/v1/plans/today', headers: {authorization}})).statusCode).toBe(404);
  });
  it('locks the initial version and one environment after starting while allowing adapted execution', async () => {
    const plan = await today(); const alternative = await today('gym');
    const started = await start(plan.id);
    expect(started.plan.startedSnapshot.exercises).toEqual(plan.exercises);
    const forbidden = await app.inject({method: 'POST', url: '/v1/plans/' + plan.id + '/substitute', headers: {authorization}, payload: {exerciseId: plan.exercises[0].id, replacementId: 'wall-pushup'}});
    expect(forbidden.statusCode).toBe(409);
    const duplicate = await app.inject({method: 'POST', url: '/v1/plans/' + alternative.id + '/start', headers: {authorization}, payload: {clientId: randomUUID()}});
    expect(duplicate.statusCode).toBe(409);
    const slot = plan.exercises[0].id;
    const adapted = await app.inject({method: 'PATCH', url: '/v1/plans/' + plan.id + '/progress', headers: {authorization}, payload: {adaptations: {[slot]: {sets: 1, note: 'Versão confortável'}}, sets: {[slot]: [true]}}});
    expect(adapted.statusCode).toBe(200); expect(adapted.json().startedSnapshot.exercises).toEqual(plan.exercises);
    await expect(pool.query("UPDATE daily_plans SET started_snapshot='{}'::jsonb WHERE id=$1", [plan.id])).rejects.toMatchObject({code: '23514'});
  });
  it('uses a frozen completion for concurrent and later default-duration retries', async () => {
    const plan = await today(); const started = await start(plan.id);
    await pool.query("UPDATE activities SET started_at=clock_timestamp()-interval '35 seconds' WHERE id=$1", [started.activity.id]);
    const request = () => app.inject({method: 'POST', url: '/v1/plans/' + plan.id + '/finish', headers: {authorization}, payload: {}});
    const responses = await Promise.all([request(),request(),request()]);
    for (const response of responses) expect(response.statusCode, response.body).toBe(200);
    const first = responses[0]!.json();
    for (const response of responses) {
      expect(response.json().activity.id).toBe(first.activity.id);
      expect(response.json().activity.activeSeconds).toBe(first.activity.activeSeconds);
    }
    expect(first.activity.activeSeconds).toBeGreaterThanOrEqual(35);
    const repeated = await app.inject({method: 'POST', url: '/v1/plans/' + plan.id + '/finish', headers: {authorization}, payload: {activeSeconds: 0, notes: 'Tentativa posterior não altera conclusão'}});
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().activity.activeSeconds).toBe(first.activity.activeSeconds);
    expect(repeated.json().activity.notes).toBe(first.activity.notes);
    const stored = await pool.query('SELECT completion_payload FROM daily_plans WHERE id=$1',[plan.id]);
    expect(stored.rows[0].completion_payload.activeSeconds).toBe(first.activity.activeSeconds);
    expect(stored.rows[0].completion_payload.serverFinishedAt).toBe(first.activity.endedAt);
    expect(stored.rows[0].completion_payload.serverFinishedAt).toBe(first.activity.receivedAt);
    const count = await pool.query("SELECT count(*) FROM activities WHERE user_id=$1",[userId]);
    expect(count.rows[0].count).toBe('1');
    const events = await pool.query("SELECT count(*) FROM daily_plan_events WHERE plan_id=$1 AND kind='completed'",[plan.id]);
    expect(events.rows[0].count).toBe('1');
    const exactReplay = await app.inject({method:'PATCH',url:'/v1/plans/'+plan.id+'/progress',headers:{authorization},payload:{sets:{},adaptations:{},notes:''}});
    expect(exactReplay.statusCode,exactReplay.body).toBe(200);
    const progress = await app.inject({method: 'PATCH',url: '/v1/plans/'+plan.id+'/progress',headers:{authorization},payload:{notes:'Já finalizada'}});
    expect(progress.statusCode).toBe(409);
  });
  it('rejects active time larger than the confirmed server interval without freezing an invalid finish', async () => {
    const plan = await today(); await start(plan.id);
    const response = await app.inject({method: 'POST',url:'/v1/plans/'+plan.id+'/finish',headers:{authorization},payload:{activeSeconds:86400}});
    expect(response.statusCode).toBe(400);
    const row = await pool.query('SELECT completion_payload,status FROM daily_plans WHERE id=$1',[plan.id]);
    expect(row.rows[0].completion_payload).toBeNull(); expect(row.rows[0].status).toBe('started');
    const retry = await app.inject({method:'POST',url:'/v1/plans/'+plan.id+'/finish',headers:{authorization},payload:{activeSeconds:0}});
    expect(retry.statusCode,retry.body).toBe(200);
  });
  it('erases private execution notes on activity deletion without reopening a training opportunity', async () => {
    const plan = await today(); const started = await start(plan.id);
    const finished = await app.inject({method:'POST',url:'/v1/plans/'+plan.id+'/finish',headers:{authorization},payload:{activeSeconds:0,notes:'Uma observação privada'}});
    expect(finished.statusCode,finished.body).toBe(200);
    const deleted = await app.inject({method:'DELETE',url:'/v1/activities/'+started.activity.id,headers:{authorization}});
    expect(deleted.statusCode,deleted.body).toBe(200);
    const row = await pool.query('SELECT completion_payload,progress,activity_id,status FROM daily_plans WHERE id=$1',[plan.id]);
    expect(row.rows[0].completion_payload).toBeNull();
    expect(row.rows[0].progress).toEqual({sets:{},adaptations:{},notes:''});
    expect(row.rows[0].activity_id).toBeNull(); expect(row.rows[0].status).toBe('completed');
    const repeated = await start(plan.id);
    expect(repeated.activity).toBeNull();
    const count = await pool.query('SELECT count(*) FROM activities WHERE user_id=$1',[userId]);
    expect(count.rows[0].count).toBe('0');
  });
  it('closes a deleted ongoing plan so retry cannot resurrect the activity', async () => {
    const plan = await today(); const started = await start(plan.id);
    const deleted = await app.inject({method:'DELETE',url:'/v1/activities/'+started.activity.id,headers:{authorization}});
    expect(deleted.statusCode,deleted.body).toBe(200);
    const resumed = await start(plan.id); expect(resumed.activity).toBeNull();
    const finished = await app.inject({method:'POST',url:'/v1/plans/'+plan.id+'/finish',headers:{authorization},payload:{}});
    expect(finished.statusCode,finished.body).toBe(200); expect(finished.json().activity).toBeNull();
    const count = await pool.query('SELECT count(*) FROM activities WHERE user_id=$1',[userId]);
    expect(count.rows[0].count).toBe('0');
  });
  it('preserves original deferred completion time without treating it as verified server time', async () => {
    const plan = await today(); const started = await start(plan.id);
    await pool.query("UPDATE activities SET started_at=clock_timestamp()-interval '60 seconds' WHERE id=$1",[started.activity.id]);
    const clock = await pool.query("SELECT clock_timestamp()-interval '20 seconds' AS original_end");
    const endedAt = new Date(clock.rows[0].original_end).toISOString();
    const response = await app.inject({method:'POST',url:'/v1/plans/'+plan.id+'/finish',headers:{authorization},payload:{activeSeconds:30,completedOffline:true,endedAt}});
    expect(response.statusCode,response.body).toBe(200);
    expect(response.json().activity.recordedEndAt).toBe(endedAt);
    expect(response.json().activity.eligibility).toBe('ineligible');
    expect(response.json().activity.ineligibleReason).toBe('unverified_offline_completion_time');
  });
  it('recovers a staged finish after a process interruption using its original server receipt', async () => {
    const plan = await today(); const started = await start(plan.id);
    const clock = await pool.query("SELECT date_trunc('milliseconds',clock_timestamp()-interval '20 seconds') AS staged_at");
    const serverFinishedAt = new Date(clock.rows[0].staged_at).toISOString();
    await pool.query("UPDATE activities SET started_at=$2::timestamptz-interval '40 seconds' WHERE id=$1",[started.activity.id,serverFinishedAt]);
    await pool.query('UPDATE daily_plans SET completion_payload=$2::jsonb WHERE id=$1',[plan.id,JSON.stringify({activeSeconds:30,notes:'',adaptations:'',completedOffline:false,serverFinishedAt})]);
    const response = await app.inject({method:'POST',url:'/v1/plans/'+plan.id+'/finish',headers:{authorization},payload:{}});
    expect(response.statusCode,response.body).toBe(200);
    expect(response.json().activity.endedAt).toBe(serverFinishedAt);
    expect(response.json().activity.receivedAt).toBe(serverFinishedAt);
    expect(response.json().activity.activeSeconds).toBe(30);
    expect(response.json().activity.eligibility).toBe('verified');
  });
  it('does not expose another account plan when its UUID is known', async () => {
    const plan = await today();
    const login = await app.inject({method:'POST',url:'/v1/auth/google',payload:{idToken:randomUUID()}});
    const other = 'Bearer '+login.json().accessToken;
    const prefs = await app.inject({method:'PATCH',url:'/v1/me/preferences',headers:{authorization:other},payload:profile});
    expect(prefs.statusCode).toBe(200);
    const start = await app.inject({method:'POST',url:'/v1/plans/'+plan.id+'/start',headers:{authorization:other},payload:{clientId:randomUUID()}});
    expect(start.statusCode).toBe(404);
  });
});
