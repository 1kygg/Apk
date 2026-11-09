import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {ProfilePreferences} from '@consta/domain';
import {getCompatibleSubstitutions,type DayPlan} from '@consta/training';

const faults=vi.hoisted(()=>({busyBeforeBegin:0,busyAfterWrite:0,errorBefore:null as Error|null,attempts:0}));

// Runs the production local SQL against SQLite. Native module/device behavior
// remains separate: this adapter does not verify Expo SQLite, sensors or photos.
vi.mock('expo-sqlite',async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const sqlite=new DatabaseSync(':memory:');
  const adapter={
    execAsync:async(sql:string)=>{sqlite.exec(sql);},
    runAsync:async(sql:string,...params:any[])=>{
      const result=sqlite.prepare(sql).run(...params);
      if(faults.busyAfterWrite>0&&sql.startsWith('INSERT INTO device_activity_summaries')){
        faults.busyAfterWrite--;throw Object.assign(new Error('database is locked'),{code:'SQLITE_BUSY_SNAPSHOT'});
      }
      return result;
    },
    getFirstAsync:async(sql:string,...params:any[])=>sqlite.prepare(sql).get(...params)??null,
    getAllAsync:async(sql:string,...params:any[])=>sqlite.prepare(sql).all(...params),
    withTransactionAsync:async(action:()=>Promise<void>)=>{
      sqlite.exec('BEGIN');try{await action();sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}
    },
    withExclusiveTransactionAsync:async(action:(tx:unknown)=>Promise<void>)=>{
      faults.attempts++;
      if(faults.errorBefore)throw faults.errorBefore;
      if(faults.busyBeforeBegin>0){faults.busyBeforeBegin--;throw Object.assign(new Error('database is locked'),{code:'SQLITE_BUSY'});}
      sqlite.exec('BEGIN IMMEDIATE');try{await action(adapter);sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}
    },
  };
  return {openDatabaseAsync:async()=>adapter};
});
vi.mock('expo-crypto',async()=>({randomUUID:(await import('node:crypto')).randomUUID}));

import {database,getLocalPreference,setLocalPreference,enqueue,queued,readActivities,type StoredActivity} from './storage';
import {deleteLocalServiceData,localRequest,type LocalActivitySummary} from './local-service';

type Plan=DayPlan & {status:'draft'|'started'|'completed';deletedActivity?:boolean};
type PlanResponse={plan:Plan;activity:LocalActivitySummary|null};
const A='9b0a3a5a-bfd7-4538-9280-78172b1d0551';
const B='7d7d4c43-7e38-4dc3-8ba7-50d507f9907d';
const profileKey='local-profile.v1';
const startTime='2026-11-09T12:00:00.000Z';
const finishTime='2026-11-09T12:10:00.000Z';
const preferences:ProfilePreferences={goal:'health',level:'beginner',availableDays:[1,2,3,4,5,6,7],durationMinutes:25,environment:'home',equipment:[],modalities:['strength'],avoidExerciseIds:[],timezone:'UTC'};
let network=vi.fn();
const call=<T>(path:string,method='GET',body?:unknown,owner=A)=>localRequest<T>(owner,path,{method,body});
const list=(owner=A)=>call<{items:LocalActivitySummary[]}>('/activities','GET',undefined,owner);
async function openProfile(owner=A){await setLocalPreference(profileKey,{id:owner,displayName:owner===A?'Ana':'Bruno',createdAt:startTime});}
async function savePreferences(owner=A,value=preferences){return call<ProfilePreferences>('/me/preferences','PATCH',value,owner);}
async function today(owner=A){return call<Plan>('/plans/today','GET',undefined,owner);}
async function startPlan(plan:Plan,owner=A){return call<PlanResponse>('/plans/'+plan.id+'/start','POST',{clientId:randomUUID()},owner);}
async function finishPlan(plan:Plan,body:Record<string,unknown>={activeSeconds:500,endedAt:finishTime},owner=A){return call<PlanResponse>('/plans/'+plan.id+'/finish','POST',body,owner);}
const manual=(clientId=randomUUID())=>({clientId,modality:'football',source:'manual',environment:'outdoor',startedAt:'2026-11-09T11:30:00.000Z',endedAt:startTime,activeSeconds:1800,totalSeconds:1800,notes:'Registro manual de teste'});

beforeEach(async()=>{
  faults.busyBeforeBegin=0;faults.busyAfterWrite=0;faults.errorBefore=null;faults.attempts=0;
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(startTime);
  const db=await database();
  await db.execAsync('DELETE FROM local_meta;DELETE FROM local_activities;');
  await openProfile();
  await call('/me'); // Initializes all device tables on the first execution.
  await db.execAsync('DELETE FROM device_activity_summaries;DELETE FROM device_plans;DELETE FROM device_preferences;DELETE FROM device_notifications;');
  network=vi.fn(()=>{throw new Error('The local store must not contact a server.');});
  vi.stubGlobal('fetch',network);
});
afterEach(()=>{expect(network).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.useRealTimers();});

describe('offline profile and SQL persistence (no OAuth, server or native hardware)',()=>{
  it('retries recognized busy conflicts after rollback without committing duplicate sessions',async()=>{
    const initial=faults.attempts;
    faults.busyBeforeBegin=1;faults.busyAfterWrite=1;
    const saved=await call<LocalActivitySummary>('/activities/start','POST',{clientId:randomUUID(),modality:'walking',source:'gps',environment:'outdoor'});
    expect(faults.attempts-initial).toBe(3);
    expect((await list()).items.map(activity=>activity.id)).toEqual([saved.id]);
  });

  it('bounds busy retries and leaves the request queue usable after a persistent conflict',async()=>{
    const initial=faults.attempts;faults.busyBeforeBegin=100;
    await expect(call('/me')).rejects.toMatchObject({code:'SQLITE_BUSY'});
    expect(faults.attempts-initial).toBe(4);
    faults.busyBeforeBegin=0;
    expect(await call('/me')).toMatchObject({id:A});
  });

  it('reports other database failures immediately without retrying arbitrary errors',async()=>{
    const initial=faults.attempts;faults.errorBefore=new Error('corrupt local database');
    await expect(call('/me')).rejects.toThrow('corrupt local database');
    expect(faults.attempts-initial).toBe(1);faults.errorBefore=null;
    expect(await call('/me')).toMatchObject({id:A});
  });

  it('persists the real local name, photo URI and preferences without network access',async()=>{
    expect(await call('/me')).toMatchObject({id:A,displayName:'Ana',profileType:'local',onboardingComplete:false});
    await call('/me','PATCH',{displayName:'Ana em movimento',avatarUrl:'file:///private/avatar.jpg'});
    await savePreferences();
    expect(await call('/me')).toMatchObject({displayName:'Ana em movimento',avatarUrl:'file:///private/avatar.jpg',onboardingComplete:true});
    expect(await call('/me/preferences')).toEqual(preferences);
    await call('/me','PATCH',{avatarUrl:null});
    expect(await call('/me')).toMatchObject({avatarUrl:null});
    await expect(call('/me','PATCH',{displayName:''})).rejects.toMatchObject({status:400});
    expect(await call('/me')).toMatchObject({displayName:'Ana em movimento'});
  });

  it('requires the opened profile and denies another profile access even with known IDs',async()=>{
    await savePreferences();const plan=await today();const started=await startPlan(plan);
    await expect(call('/activities/start','POST',{clientId:randomUUID(),modality:'walking',source:'gps',environment:'outdoor'},B)).rejects.toMatchObject({status:401});
    await openProfile(B);
    await expect(call('/me','GET',undefined,A)).rejects.toMatchObject({status:401});
    await expect(call('/activities/'+started.activity!.id,'GET',undefined,B)).rejects.toMatchObject({status:404});
    await expect(call('/plans/'+plan.id+'/progress','PATCH',{notes:'other profile'},B)).rejects.toMatchObject({status:404});
    expect((await list(B)).items).toEqual([]);
  });

  it('persists one daily suggestion under concurrent reads and preference changes',async()=>{
    await savePreferences();
    const results=await Promise.all(Array.from({length:8},()=>today()));
    expect(new Set(results.map(plan=>plan.id)).size).toBe(1);
    expect(results[0].kind).toBe('training');
    const stored=results[0];
    await savePreferences(A,{...preferences,durationMinutes:90,level:'advanced'});
    expect(await today()).toEqual(stored);
    const count=await (await database()).getFirstAsync<{count:number}>('SELECT count(*) AS count FROM device_plans WHERE owner_id=?',A);
    expect(count?.count).toBe(1);
  });

  it('allows compatible substitutions and adapted progress while preserving the started snapshot',async()=>{
    await savePreferences();const plan=await today();
    const slot=plan.exercises.find(exercise=>getCompatibleSubstitutions(preferences,exercise.exerciseId).length>0)!;
    expect(slot).toBeDefined();
    const alternative=getCompatibleSubstitutions(preferences,slot.exerciseId)[0];
    const substituted=await call<Plan>('/plans/'+plan.id+'/substitute','POST',{exerciseId:slot.id,replacementId:alternative.id});
    expect(substituted.exercises.find(exercise=>exercise.id===slot.id)?.exerciseId).toBe(alternative.id);
    const started=await startPlan(substituted);
    expect(started.plan.startedSnapshot?.exercises).toEqual(substituted.exercises);
    const patch={sets:{[slot.id]:[true]},adaptations:{[slot.id]:{sets:1,note:'Uma série confortável'}},notes:'Adaptação pessoal'};
    const adapted=await call<Plan>('/plans/'+plan.id+'/progress','PATCH',patch);
    expect(adapted.progress).toMatchObject(patch);
    expect(adapted.startedSnapshot).toEqual(started.plan.startedSnapshot);
    await expect(call('/plans/'+plan.id+'/substitute','POST',{exerciseId:slot.id,replacementId:slot.exerciseId})).rejects.toMatchObject({status:409});
    await expect(call('/plans/today?environment=gym')).rejects.toMatchObject({status:409});
    vi.setSystemTime(finishTime);
    const done=await finishPlan(plan,{activeSeconds:500,endedAt:finishTime,notes:patch.notes,adaptations:patch.adaptations});
    expect(done.plan.progress).toMatchObject(patch);
    expect(done.activity).toMatchObject({status:'completed',eligibility:'local_only',syncStatus:'local_saved',timeAuthority:'device'});
    expect(await call('/plans/'+plan.id+'/progress','PATCH',patch)).toEqual(done.plan);
    await expect(call('/plans/'+plan.id+'/progress','PATCH',{notes:'Changed after finishing'})).rejects.toMatchObject({status:409});
  });

  it('freezes completion once across simultaneous requests and retries with different client metrics',async()=>{
    await savePreferences();const plan=await today();await startPlan(plan);vi.setSystemTime(finishTime);
    const results=await Promise.all(Array.from({length:6},()=>finishPlan(plan)));
    expect(new Set(results.map(result=>result.activity?.id)).size).toBe(1);
    expect((await list()).items).toHaveLength(1);
    const retry=await finishPlan(plan,{activeSeconds:100,endedAt:'2026-11-09T12:11:00.000Z'});
    expect(retry).toEqual(results[0]);
    expect(retry.activity).not.toHaveProperty('verifiedStartAt');
    expect(retry.activity).not.toHaveProperty('serverTime');
  });

  it('rolls back invalid completion including progress, then permits a valid completion',async()=>{
    await savePreferences();const plan=await today();await startPlan(plan);vi.setSystemTime(finishTime);
    await expect(finishPlan(plan,{activeSeconds:99999,endedAt:finishTime,notes:'Must roll back'})).rejects.toMatchObject({status:400});
    const preserved=await today();
    expect(preserved.status).toBe('started');expect(preserved.progress?.notes).toBe('');
    expect((await list()).items[0].status).toBe('started');
    const done=await finishPlan(plan);
    expect(done.activity?.status).toBe('completed');
  });

  it('deduplicates simultaneous cardio starts and completions without silently replacing saved metrics',async()=>{
    const start={clientId:randomUUID(),modality:'walking',source:'gps',environment:'outdoor'};
    const opened=await Promise.all(Array.from({length:6},()=>call<LocalActivitySummary>('/activities/start','POST',start)));
    expect(new Set(opened.map(activity=>activity.id)).size).toBe(1);
    vi.setSystemTime(finishTime);
    const body={clientId:start.clientId,activeSeconds:500,totalSeconds:600,distanceMeters:700,steps:600,endedAt:finishTime};
    const complete=()=>call<LocalActivitySummary>('/activities/'+opened[0].id+'/complete','POST',body);
    const saved=await Promise.all(Array.from({length:6},complete));
    expect(new Set(saved.map(activity=>activity.id)).size).toBe(1);
    expect(saved[0]).toMatchObject({eligibility:'local_only',timeAuthority:'device',distanceMeters:700});
    expect((await list()).items).toHaveLength(1);
    await expect(call('/activities/'+opened[0].id+'/complete','POST',{...body,distanceMeters:800})).rejects.toMatchObject({status:409});
    expect((await list()).items[0].distanceMeters).toBe(700);
  });

  it('serializes local summaries with the native capture outbox on the same SQLite database',async()=>{
    const clientId=randomUUID(),captureId=randomUUID();
    const input={clientId,modality:'walking',source:'gps',environment:'outdoor'};
    const capture={clientId:captureId,ownerId:A,syncStatus:'pending',notes:'GPS local em andamento'} as StoredActivity;
    const [first,,second]=await Promise.all([
      call<LocalActivitySummary>('/activities/start','POST',input),
      enqueue(capture),
      call<LocalActivitySummary>('/activities/start','POST',input),
    ]);
    expect(second.id).toBe(first.id);
    expect((await list()).items).toHaveLength(1);
    expect(await queued(A)).toEqual([captureId]);
    expect((await readActivities(A))[0].clientId).toBe(captureId);
  });

  it('registers a manual sport by duration and retains original local timestamps on duplicate import',async()=>{
    const input=manual();const first=await call<LocalActivitySummary>('/activities/import','POST',input);
    const again=await call<LocalActivitySummary>('/activities/import','POST',input);
    expect(again).toEqual(first);
    expect(first).toMatchObject({modality:'football',source:'manual',activeSeconds:1800,startedAt:input.startedAt,endedAt:input.endedAt,eligibility:'local_only'});
    expect(first).not.toHaveProperty('distanceMeters');expect(first).not.toHaveProperty('steps');
    await expect(call('/activities/import','POST',{...manual(),distanceMeters:0})).rejects.toMatchObject({code:'DISTANCE_NOT_APPLICABLE'});
    await expect(call('/activities/import','POST',{...manual(),source:'healthkit'})).rejects.toMatchObject({status:400});
    expect((await list()).items).toHaveLength(1);
  });

  it('prevents GPS stationary metrics and cycling steps, while preserving anomaly labels locally',async()=>{
    await expect(call('/activities/start','POST',{clientId:randomUUID(),modality:'cycling',source:'gps',environment:'gym'})).rejects.toMatchObject({code:'GPS_OUTDOOR_ONLY'});
    const opened=await call<LocalActivitySummary>('/activities/start','POST',{clientId:randomUUID(),modality:'cycling',source:'gps',environment:'outdoor'});
    vi.setSystemTime(finishTime);
    await expect(call('/activities/'+opened.id+'/complete','POST',{activeSeconds:500,steps:300,endedAt:finishTime})).rejects.toMatchObject({code:'STEPS_NOT_APPLICABLE'});
    const saved=await call<LocalActivitySummary>('/activities/'+opened.id+'/complete','POST',{activeSeconds:500,distanceMeters:1500,endedAt:finishTime,anomalies:['mock_location']});
    expect(saved.warnings).toContain('mock_location');expect(saved.anomalies).toEqual(['mock_location']);
    expect(saved.eligibility).toBe('local_only');
  });

  it.each(['started','completed'] as const)('deletes a %s training activity without recreating it on start/finish retries',async state=>{
    await savePreferences();const plan=await today();let response=await startPlan(plan);
    if(state==='completed'){vi.setSystemTime(finishTime);response=await finishPlan(plan);}
    await call('/activities/'+response.activity!.id,'DELETE');
    expect((await list()).items).toEqual([]);
    const resumed=await startPlan(plan),finished=await finishPlan(plan);
    expect(resumed).toMatchObject({plan:{id:plan.id,status:'completed',deletedActivity:true},activity:null});
    expect(finished.activity).toBeNull();expect((await list()).items).toEqual([]);
    expect((await today()).id).toBe(plan.id);
  });

  it('deletes the selected local profile service data and preserves all other profile rows',async()=>{
    const reminders={enabled:true,days:[1,3,5],hour:8,minute:0,quietStartMinute:1320,quietEndMinute:420};
    await savePreferences();await today();await call('/activities/import','POST',manual());
    await call('/me/notifications','PATCH',reminders);await setLocalPreference('local-score-rules.'+A,{dailyCap:1});
    await openProfile(B);await savePreferences(B);const bPlan=await today(B);
    await call('/activities/import','POST',manual(),B);
    await call('/me/notifications','PATCH',reminders,B);await setLocalPreference('local-score-rules.'+B,{dailyCap:2});
    await deleteLocalServiceData(A);
    const db=await database();
    for(const table of ['device_preferences','device_notifications','device_plans','device_activity_summaries']){
      expect((await db.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM '+table+' WHERE owner_id=?',A))?.count).toBe(0);
      expect((await db.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM '+table+' WHERE owner_id=?',B))?.count).toBeGreaterThan(0);
    }
    expect(await getLocalPreference('local-score-rules.'+A)).toBeNull();
    expect(await getLocalPreference('local-score-rules.'+B)).toEqual({dailyCap:2});
    expect((await today(B)).id).toBe(bPlan.id);
    expect(await call('/me','GET',undefined,B)).toMatchObject({id:B,displayName:'Bruno'});
  });
});
