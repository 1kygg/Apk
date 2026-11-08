import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import type {FastifyInstance,InjectOptions} from 'fastify';
import {buildApp} from '../src/app.js';
import {migrate} from '../src/migrate.js';
import type {ApiConfig} from '../src/config.js';
import {getCompatibleSubstitutions} from '@consta/training';
import type {ProfilePreferences} from '@consta/domain';
const enabled=process.env.RUN_DB_TESTS==='1';
const config:ApiConfig={jwtSecret:'integration-only-not-a-real-secret-123456789',googleClientIds:['fixture.apps.googleusercontent.com'],appleClientIds:['fixture.apple'],issuer:'consta-api',audience:'consta-native'};
const preferences:ProfilePreferences={goal:'health',level:'beginner',availableDays:[1,2,3,4,5,6,7],durationMinutes:20,environment:'home',equipment:[],modalities:['strength'],avoidExerciseIds:[],timezone:'UTC'};
describe.runIf(enabled)('PostgreSQL integration (test verifier injection; not real Google or native hardware)',()=>{
  let pool:Pool;let app:FastifyInstance;
  let alice:any;let bob:any;
  const headers=(session:any)=>({authorization:'Bearer '+session.accessToken});
  async function call(method:InjectOptions['method'],url:string,payload?:unknown,session=alice){
    return app.inject({method,url:'/v1'+url,...(payload===undefined?{}:{payload:payload as any}),headers:session?headers(session):{}});
  }
  async function login(sub:string){
    const res=await app.inject({method:'POST',url:'/v1/auth/google',payload:{idToken:sub}});
    expect(res.statusCode,res.body).toBe(200);return res.json();
  }
  function rules(overrides:Record<string,unknown>={}){
    const now=Date.now();
    return {type:'consistency',startsAt:new Date(now-3600000).toISOString(),endsAt:new Date(now+7*86400000).toISOString(),timezone:'UTC',validDays:[1,2,3,4,5,6,7],makeupDays:[],dailyCap:1,weeklyCap:5,pointsPerDay:1,weeklyGoal:5,weekStartsOn:1,allowedModalities:['strength','walking','running','cycling','football','basketball','volleyball'],acceptedSources:['self_reported','gps','manual','health_connect','healthkit'],syncGraceHours:24,offlinePolicy:'review',tieBreak:'weeks_met',minimumActiveSeconds:0,...overrides};
  }
  async function group(){
    const res=await call('POST','/groups',{name:'Amigos reais',description:'Fixture isolada de teste'});
    expect(res.statusCode,res.body).toBe(200);return res.json();
  }
  async function challenge(groupId:string,override:Record<string,unknown>={}){
    const res=await call('POST','/groups/'+groupId+'/challenges',{name:'Constância',rules:rules(override)});
    expect(res.statusCode,res.body).toBe(200);return res.json();
  }
  async function join(groupId:string,session=bob){
    const invite=await call('POST','/groups/'+groupId+'/invites',{});
    expect(invite.statusCode,invite.body).toBe(200);
    const accepted=await call('POST','/invites/accept',{code:invite.json().code},session);
    expect(accepted.statusCode,accepted.body).toBe(200);
  }
  async function start(modality='strength',source='self_reported',environment='home',clientId=randomUUID()){
    const res=await call('POST','/activities/start',{clientId,modality,source,environment});
    expect(res.statusCode,res.body).toBe(200);return res.json();
  }
  beforeAll(async()=>{
    const connectionString=process.env.TEST_DATABASE_URL??process.env.DATABASE_URL;
    if(!connectionString)throw new Error('RUN_DB_TESTS=1 exige TEST_DATABASE_URL ou DATABASE_URL de teste.');
    if(!/(^|[_-])test([_-]|$)/i.test(new URL(connectionString).pathname.slice(1)))throw new Error('Fixtures destrutivas exigem banco com nome de teste, como consta_test.');
    pool=new Pool({connectionString,max:16});
    await migrate(pool);
    await migrate(pool);
  });
  beforeEach(async()=>{
    await pool.query('TRUNCATE users,groups,apple_nonces RESTART IDENTITY CASCADE');
    app=await buildApp({pool,config,verifyIdentity:async(_provider,token)=>({sub:token,displayName:token==='alice'?'Alice':'Bruno'})});
    alice=await login('alice');bob=await login('bob');
  });
  afterEach(async()=>{await app.close();});
  afterAll(async()=>{await pool?.end();});
  it('rotates refresh tokens, revokes a replayed family, persists identity, and logs out',async()=>{
    const me=await call('GET','/me');expect(me.json().id).toBe(alice.user.id);
    const repeat=await login('alice');expect(repeat.user.id).toBe(alice.user.id);
    const rotated=await app.inject({method:'POST',url:'/v1/auth/refresh',payload:{refreshToken:alice.refreshToken}});
    expect(rotated.statusCode,rotated.body).toBe(200);
    const replay=await app.inject({method:'POST',url:'/v1/auth/refresh',payload:{refreshToken:alice.refreshToken}});
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('REFRESH_REUSED');
    expect((await call('GET','/me',undefined,rotated.json())).statusCode).toBe(401);
    const rejected=await app.inject({method:'POST',url:'/v1/auth/refresh',payload:{refreshToken:rotated.json().refreshToken}});
    expect(rejected.statusCode).toBe(401);
    expect((await call('POST','/auth/logout',{refreshToken:repeat.refreshToken},repeat)).statusCode).toBe(200);
    expect((await call('GET','/me',undefined,repeat)).statusCode).toBe(401);
  });
  it('consumes Apple nonces exactly once even with a verifier fixture',async()=>{
    const nonce=await app.inject({method:'POST',url:'/v1/auth/apple/nonce'});
    expect(nonce.statusCode).toBe(200);
    const body={identityToken:'fixture-apple',nonceId:nonce.json().nonceId,displayName:'Apple fixture'};
    expect((await app.inject({method:'POST',url:'/v1/auth/apple',payload:body})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/v1/auth/apple',payload:body})).statusCode).toBe(401);
  });
  it('isolates groups/challenges and never exposes emails or private session notes',async()=>{
    const g=await group();const c=await challenge(g.id);
    expect((await call('GET','/groups/'+g.id,undefined,bob)).statusCode).toBe(404);
    expect((await call('GET','/groups/'+g.id+'/members',undefined,bob)).statusCode).toBe(404);
    expect((await call('GET','/challenges/'+c.id+'/ranking',undefined,bob)).statusCode).toBe(404);
    const invite=(await call('POST','/groups/'+g.id+'/invites',{})).json();
    expect(invite.url).toContain(invite.code);
    await call('DELETE','/groups/'+g.id+'/invites/'+invite.id);
    expect((await call('POST','/invites/accept',{code:invite.code},bob)).statusCode).toBe(404);
    await join(g.id);
    const members=await call('GET','/groups/'+g.id+'/members',undefined,bob);
    expect(members.json().items).toHaveLength(2);
    expect(members.body).not.toMatch(/email|google_sub|apple_sub|token|route/i);
    expect((await call('POST','/groups/'+g.id+'/invites',{},bob)).statusCode).toBe(403);
    expect((await call('PATCH','/groups/'+g.id+'/members/'+alice.user.id,{role:'member'})).statusCode).toBe(409);
    expect((await call('GET','/activities',undefined,bob)).json().items).toEqual([]);
  });
  it('uses transactions and unique keys for simultaneous starts/completions and one daily credit',async()=>{
    const g=await group();const c=await challenge(g.id);
    const clientId=randomUUID();
    const starts=await Promise.all([call('POST','/activities/start',{clientId,modality:'strength',source:'self_reported',environment:'home'}),call('POST','/activities/start',{clientId,modality:'strength',source:'self_reported',environment:'home'})]);
    expect(starts.map(r=>r.statusCode)).toEqual([200,200]);
    expect(starts[0]!.json().id).toBe(starts[1]!.json().id);
    const id=starts[0]!.json().id;
    const finishes=await Promise.all([call('POST','/activities/'+id+'/complete',{activeSeconds:0,notes:'privado'}),call('POST','/activities/'+id+'/complete',{activeSeconds:0,notes:'privado'})]);
    expect(finishes.map(r=>r.statusCode)).toEqual([200,200]);
    expect((await call('POST','/activities/'+id+'/complete',{activeSeconds:1,notes:'alterado'})).statusCode).toBe(409);
    const other=await start();
    expect((await call('POST','/activities/'+other.id+'/complete',{activeSeconds:0})).statusCode).toBe(200);
    const rank=await call('GET','/challenges/'+c.id+'/ranking');
    expect(rank.json().items.find((r:any)=>r.userId===alice.user.id).total).toBe(1);
    const ledger=await pool.query('SELECT count(*) AS count FROM consistency_credits WHERE challenge_id=$1',[c.id]);
    expect(Number(ledger.rows[0].count)).toBe(1);
    expect(rank.body).not.toContain('privado');
    expect((await call('POST','/activities/start',{clientId,modality:'running',source:'gps',environment:'outdoor'})).statusCode).toBe(409);
  });
  it('saves original offline dates without automatic points; review affects only its selected challenge',async()=>{
    const g=await group();await join(g.id);
    const a=await challenge(g.id);const b=await challenge(g.id);
    const now=Date.now(),originalStart=new Date(now-600000).toISOString(),originalEnd=new Date(now-300000).toISOString();
    const res=await call('POST','/activities/import',{clientId:randomUUID(),modality:'walking',source:'gps',environment:'outdoor',startedAt:originalStart,endedAt:originalEnd,activeSeconds:300,distanceMeters:300,notes:'segredo pessoal'});
    expect(res.statusCode,res.body).toBe(200);
    const activity=res.json();expect(activity.eligibility).toBe('pending_review');expect(activity.recordedStartAt).toBe(originalStart);
    const before=(await call('GET','/challenges/'+a.id+'/ranking')).json();
    expect(before.items.find((r:any)=>r.userId===alice.user.id).total).toBe(0);
    expect((await call('GET','/challenges/'+a.id+'/review-queue',undefined,bob)).statusCode).toBe(403);
    const queue=await call('GET','/challenges/'+a.id+'/review-queue');expect(queue.body).not.toContain('segredo pessoal');
    const review=await call('POST','/activities/'+activity.id+'/review',{challengeId:a.id,decision:'approve',reason:'Horário revisado com o participante.'});
    expect(review.statusCode,review.body).toBe(200);
    expect((await call('GET','/challenges/'+a.id+'/ranking')).json().items.find((r:any)=>r.userId===alice.user.id).total).toBe(1);
    expect((await call('GET','/challenges/'+b.id+'/ranking')).json().items.find((r:any)=>r.userId===alice.user.id).total).toBe(0);
    await call('DELETE','/activities/'+activity.id);
    expect((await call('GET','/challenges/'+a.id+'/ranking')).json().items.find((r:any)=>r.userId===alice.user.id).total).toBe(0);
  });
  it('deduplicates provider records and marks overlapping multi-source imports without multiplying kilometers',async()=>{
    const g=await group();const c=await challenge(g.id,{type:'walking',dailyCap:20,weeklyCap:100,weeklyGoal:30});
    const body={clientId:randomUUID(),modality:'walking',source:'health_connect',environment:'outdoor',sourceRecordId:'provider-record-123',startedAt:new Date(Date.now()-1200000).toISOString(),endedAt:new Date(Date.now()-600000).toISOString(),activeSeconds:600,distanceMeters:900};
    const first=await call('POST','/activities/import',body);expect(first.statusCode,first.body).toBe(200);
    const repeat=await call('POST','/activities/import',{...body,clientId:randomUUID()});
    expect(repeat.statusCode,repeat.body).toBe(200);expect(repeat.json().id).toBe(first.json().id);
    const overlap=await call('POST','/activities/import',{...body,clientId:randomUUID(),source:'healthkit',sourceRecordId:'other-source'});
    expect(overlap.statusCode,overlap.body).toBe(200);expect(overlap.json().eligibility).toBe('ineligible');
    expect(overlap.json().warnings).toContain('overlapping_interval_requires_review');
    const rank=(await call('GET','/challenges/'+c.id+'/ranking')).json();
    expect(rank.unit).toBe('kilometers');expect(rank.items[0].total).toBe(0);
  });
  it('requires a matching preview, revision and reason for post-start changes; sends persisted notices',async()=>{
    const g=await group();await join(g.id);const c=await challenge(g.id);
    const updatedRules={...c.rules,weeklyCap:2,weeklyGoal:2};
    const reason='A equipe aprovou a alteração do limite.';
    expect((await call('PATCH','/challenges/'+c.id,{rules:updatedRules,reason})).statusCode).toBe(409);
    const preview=await call('POST','/challenges/'+c.id+'/preview-change',{rules:updatedRules,reason});
    expect(preview.statusCode,preview.body).toBe(200);expect(preview.json().before.items).toHaveLength(2);
    const saved=await call('PATCH','/challenges/'+c.id,{rules:updatedRules,reason,changeToken:preview.json().changeToken});
    expect(saved.statusCode,saved.body).toBe(200);expect(saved.json().revision).toBe(2);
    const reused=await call('PATCH','/challenges/'+c.id,{rules:{...updatedRules,weeklyCap:3,weeklyGoal:3},reason,changeToken:preview.json().changeToken});
    expect(reused.statusCode).toBe(409);
    const notices=await call('GET','/notifications',undefined,bob);
    const changed=notices.json().items.find((n:any)=>n.title==='Regulamento atualizado');
    expect(changed).toBeTruthy();expect((await call('PATCH','/notifications/'+changed.id+'/read',{},bob)).statusCode).toBe(200);
    const audit=(await call('GET','/groups/'+g.id+'/audit',undefined,bob)).json().items;
    expect(audit.some((a:any)=>a.action==='challenge_updated'&&a.reason===reason)).toBe(true);
  });
  it('rejects impossible clocks/metrics, preserves offline completion, and disallows GPS for stationary cardio',async()=>{
    const g=await group();await challenge(g.id);
    const s=await start('walking','gps','outdoor');
    const impossible=await call('POST','/activities/'+s.id+'/complete',{activeSeconds:99999});
    expect(impossible.statusCode).toBe(400);
    const flagged=await call('POST','/activities/'+s.id+'/complete',{activeSeconds:0,distanceMeters:50000,anomalies:['mock_location']});
    expect(flagged.statusCode,flagged.body).toBe(200);expect(flagged.json().eligibility).toBe('ineligible');
    expect((await call('POST','/activities/start',{clientId:randomUUID(),modality:'cycling',source:'gps',environment:'gym'})).statusCode).toBe(400);
    const cycle=await start('cycling','manual','gym');
    expect((await call('POST','/activities/'+cycle.id+'/complete',{activeSeconds:0,steps:123})).statusCode).toBe(400);
    const offline=await start();
    const done=await call('POST','/activities/'+offline.id+'/complete',{activeSeconds:0,completedOffline:true,endedAt:new Date().toISOString()});
    expect(done.statusCode,done.body).toBe(200);expect(done.json().eligibility).toBe('pending_review');
  });
  it('persists a daily plan, locks its snapshot, adapts without extra sessions, and isolates ownership',async()=>{
    expect((await call('PATCH','/me/preferences',preferences)).statusCode).toBe(200);
    const [left,right]=await Promise.all([call('GET','/plans/today'),call('GET','/plans/today')]);
    expect(left.statusCode,left.body).toBe(200);expect(right.statusCode,right.body).toBe(200);
    let plan=left.json();expect(plan.id).toBe(right.json().id);expect(plan.kind).not.toBe('rest');
    const first=plan.exercises[0];
    const choices=getCompatibleSubstitutions(preferences,first.exerciseId);
    if(choices.length){
      const swapped=await call('POST','/plans/'+plan.id+'/substitute',{exerciseId:first.id,replacementId:choices[0]!.id});
      expect(swapped.statusCode,swapped.body).toBe(200);plan=swapped.json();
    }
    expect((await call('POST','/plans/'+plan.id+'/start',{clientId:randomUUID()},bob)).statusCode).toBeGreaterThanOrEqual(400);
    const begun=await call('POST','/plans/'+plan.id+'/start',{clientId:randomUUID()});
    expect(begun.statusCode,begun.body).toBe(200);
    const snapshot=(await pool.query('SELECT started_snapshot FROM daily_plans WHERE id=$1',[plan.id])).rows[0].started_snapshot;
    const slot=plan.exercises[0];
    const reduced=await call('PATCH','/plans/'+plan.id+'/progress',{adaptations:{[slot.id]:{sets:1,note:'Versão mais confortável.'}},sets:{[slot.id]:[true]}});
    expect(reduced.statusCode,reduced.body).toBe(200);
    const preserved=(await pool.query('SELECT started_snapshot FROM daily_plans WHERE id=$1',[plan.id])).rows[0].started_snapshot;
    expect(preserved).toEqual(snapshot);
    const again=await call('POST','/plans/'+plan.id+'/start',{clientId:randomUUID()});
    expect(again.statusCode,again.body).toBe(200);expect(again.json().activity.id).toBe(begun.json().activity.id);
    expect((await call('POST','/plans/'+plan.id+'/substitute',{exerciseId:slot.id,replacementId:slot.exerciseId})).statusCode).toBe(409);
    const done=await call('POST','/plans/'+plan.id+'/finish',{});
    expect(done.statusCode,done.body).toBe(200);
    const [doneAgain,doneChanged]=await Promise.all([call('POST','/plans/'+plan.id+'/finish',{}),call('POST','/plans/'+plan.id+'/finish',{activeSeconds:1,notes:'Tentativa de mudar conclusão'})]);
    expect(doneAgain.statusCode,doneAgain.body).toBe(200);expect(doneChanged.statusCode,doneChanged.body).toBe(200);
    expect(doneAgain.json().activity.id).toBe(done.json().activity.id);expect(doneChanged.json().activity.id).toBe(done.json().activity.id);
    const count=await pool.query('SELECT count(*) AS count FROM activities WHERE user_id=$1 AND plan_id=$2',[alice.user.id,plan.id]);
    expect(Number(count.rows[0].count)).toBe(1);
    expect((await call('PATCH','/plans/'+plan.id+'/progress',{notes:'acesso indevido'},bob)).statusCode).toBeGreaterThanOrEqual(400);
  });
  it('serializes completion and deletion without deadlocks or residual points',async()=>{
    const g=await group();const c=await challenge(g.id);
    for(let i=0;i<5;i++){
      const activity=await start();
      const [done,removed]=await Promise.all([
        call('POST','/activities/'+activity.id+'/complete',{activeSeconds:0}),
        call('DELETE','/activities/'+activity.id),
      ]);
      expect([200,404]).toContain(done.statusCode);
      expect(removed.statusCode,removed.body).toBe(200);
    }
    const ranking=await call('GET','/challenges/'+c.id+'/ranking');
    expect(ranking.json().items[0].total).toBe(0);
    expect((await call('GET','/activities')).json().items).toEqual([]);
  });
  it('deletes account data, revokes sessions, and retains the group with a successor admin',async()=>{
    const g=await group();await join(g.id);const c=await challenge(g.id);
    await call('PATCH','/me/preferences',preferences);
    const session=await start();await call('POST','/activities/'+session.id+'/complete',{activeSeconds:0,notes:'apagar'});
    const deleted=await call('DELETE','/me',{confirm:true});expect(deleted.statusCode,deleted.body).toBe(200);
    expect((await call('GET','/me')).statusCode).toBe(401);
    const users=await pool.query('SELECT 1 FROM users WHERE id=$1',[alice.user.id]);expect(users.rowCount).toBe(0);
    const activities=await pool.query('SELECT 1 FROM activities WHERE user_id=$1',[alice.user.id]);expect(activities.rowCount).toBe(0);
    const prefs=await pool.query('SELECT 1 FROM user_preferences WHERE user_id=$1',[alice.user.id]);expect(prefs.rowCount).toBe(0);
    const groupAfter=await call('GET','/groups/'+g.id,undefined,bob);expect(groupAfter.statusCode,groupAfter.body).toBe(200);expect(groupAfter.json().role).toBe('admin');
    const rank=await call('GET','/challenges/'+c.id+'/ranking',undefined,bob);expect(rank.statusCode).toBe(200);expect(rank.json().items.some((r:any)=>r.userId===alice.user.id)).toBe(false);
  });
});
