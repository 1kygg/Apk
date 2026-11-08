import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { GpsFilter } from '@consta/domain';
import { api, ApiError } from './api';
import { getSession, registerSessionCleanup } from './auth';
import { advanceRecordingClock } from './recording-model';
import { startSessionSteps } from './steps';
import {
  type StoredActivity, putActivity, readActivity, readActivities,
  appendPoint, readRoute, setActiveId, getActiveId,
  enqueue, queued, acknowledge, markAttempt, removeActivity, deleteOwnerData, deleteRoute,
} from './storage';
import type { CardioModality, Environment, LocalActivity, Modality, RoutePoint, TrackerState } from './types';
export { activityMetrics } from './recording-model';
const LOCATION_TASK = 'consta.user-cardio-location.v1';
const runtimeId = Crypto.randomUUID();
let current: StoredActivity | null = null;
let route: RoutePoint[] = [];
let filter: GpsFilter | null = null;
let foregroundWatch: Location.LocationSubscription | null = null;
let stepWatch: { stop: () => void } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let serial = Promise.resolve();
let syncQueue: Promise<void> | null = null;
let lastPersistedAt = 0;
let initialized = false;
let removeAppState: (()=>void) | null = null;
let removeNetwork: (()=>void) | null = null;
let lastError: string | null = null;
let syncing = false;
const subscribers = new Set<(state: TrackerState) => void>();
function locked<T>(action:()=>Promise<T>):Promise<T>{
  const result=serial.then(action,action);
  serial=result.then(()=>{},()=>{});
  return result;
}
function ownerId(){
  const id=getSession()?.user.id;
  if(!id)throw new ApiError('Entre para manter seu histórico privado.','AUTH_REQUIRED',401);
  return id;
}
function publicActivity(activity:StoredActivity):LocalActivity{
  const {segment,filterSnapshot,runtimeId:run,lastTickAt,lastMonotonic,endedOffline,stepsEnabled,pendingDelete,...result}=activity;
  return result;
}
export function getTracker():TrackerState{
  return {activity:current?publicActivity(current):null,route:[...route],backgroundEnabled:current?.backgroundEnabled??false,error:lastError,syncing};
}
export function subscribeTracker(listener:(state:TrackerState)=>void){
  subscribers.add(listener);return()=>{subscribers.delete(listener);};
}
function emit(){const state=getTracker();for(const listener of subscribers)listener(state);}
function monotonic(){return performance.now();}
function accrue(){
  if(!current)return;
  current=advanceRecordingClock(current,Date.now(),monotonic(),runtimeId);
  if(current.status==='interrupted'){
    filter?.pause();
    current.segment++;
    current.filterSnapshot=filter?.snapshot()??null;
    stepWatch?.stop();stepWatch=null;
  }
}
async function persist(){if(current){await putActivity(current);lastPersistedAt=Date.now();}}
function ensureTimer(){
  if(timer)return;
  timer=setInterval(()=>{
    void locked(async()=>{
      if(!current||!['recording','paused'].includes(current.status))return;
      accrue();emit();
      if(Date.now()-lastPersistedAt>=10000)await persist();
      if(current?.status==='interrupted')await stopNativeLocation();
    }).catch(error=>{lastError=error instanceof Error?error.message:'Falha ao salvar progresso local.';emit();});
  },1000);
}
async function stopNativeLocation(){
  foregroundWatch?.remove();foregroundWatch=null;
  stepWatch?.stop();stepWatch=null;
  try{
    if(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }catch{/* Permission may already have been revoked by the user. */}
}
function resetClock(){
  if(current){current.lastTickAt=Date.now();current.lastMonotonic=monotonic();current.runtimeId=runtimeId;}
}
async function hydrateForBackground():Promise<boolean>{
  if(current)return true;
  const id=await getActiveId();if(!id)return false;
  current=await readActivity(id);
  if(!current)return false;
  filter=new GpsFilter(current.modality as CardioModality);
  if(current.filterSnapshot)filter.restore(current.filterSnapshot as ReturnType<GpsFilter['snapshot']>);
  if(current.runtimeId!==runtimeId&&['recording','paused'].includes(current.status)){
    current.status='interrupted';
    current.signal='lost';
    current.stepsReliable=false;
    current.eligibilityReason='O processo foi interrompido. Retome a sessão para registrar novos dados.';
    filter.pause();current.segment++;current.filterSnapshot=filter.snapshot();
    await persist();
    return false;
  }
  return true;
}
async function acceptLocations(locations:Location.LocationObject[]){
  if(!(await hydrateForBackground())||!current||current.status!=='recording')return;
  accrue();
  if(!current||current.status!=='recording'){await persist();return;}
  if(!filter)filter=new GpsFilter(current.modality as CardioModality);
  for(const location of [...locations].sort((a,b)=>a.timestamp-b.timestamp)){
    if(location.mocked){
      current.eligibilityReason='Localização marcada pelo sistema como simulada; atividade pode precisar de revisão.';
    }
    const point={latitude:location.coords.latitude,longitude:location.coords.longitude,accuracy:location.coords.accuracy??Number.POSITIVE_INFINITY,timestamp:location.timestamp};
    const result=filter.push(point,Date.now());
    if(result.breakSegment)current.segment++;
    current.signal=result.accepted?'good':result.reason==='inaccurate'?'weak':result.reason==='jitter'?current.signal:'lost';
    if(result.accepted&&result.point){
      const accepted={...result.point,segment:current.segment};
      current.distanceMeters=result.totalDistanceMeters;
      current.pointCount++;
      await appendPoint(current.clientId,accepted);
      // Keep live rendering bounded. Full private route remains in SQLite.
      route.push(accepted);
      if(route.length>3000)route=route.filter((_,index)=>index%2===0||index===route.length-1);
    }
  }
  current.filterSnapshot=filter.snapshot();
  await persist();emit();
}
if(!TaskManager.isTaskDefined(LOCATION_TASK)){
  TaskManager.defineTask<{locations:Location.LocationObject[]}>(LOCATION_TASK,async({data,error})=>{
    if(error){
      await locked(async()=>{
        if(!(await hydrateForBackground())||!current)return;
        accrue();current.status='interrupted';current.signal='lost';current.stepsReliable=false;
        current.eligibilityReason='Registro de localização interrompido. Retome quando a localização estiver disponível.';
        lastError=error.message;await persist();emit();
      });
      return;
    }
    if(data?.locations)await locked(()=>acceptLocations(data.locations));
  });
}
async function requestForegroundLocation(){
  const permission=await Location.requestForegroundPermissionsAsync();
  if(!permission.granted)throw new ApiError('A localização é necessária para medir o percurso. Você pode registrar duração e distância manualmente.','LOCATION_DENIED');
  if(!(await Location.hasServicesEnabledAsync()))throw new ApiError('Ative a localização do aparelho para registrar seu percurso.','LOCATION_DISABLED');
}
async function beginNativeLocation(background:boolean){
  if(!current)return;
  const options:Location.LocationOptions={
    accuracy:Location.Accuracy.High,distanceInterval:3,timeInterval:4000,mayShowUserSettingsDialog:true,
  };
  if(Platform.OS==='android'&&background){
    // SDK54 permits a user-initiated location foreground service with only
    // foreground permission. No ACCESS_BACKGROUND_LOCATION is requested.
    await Location.startLocationUpdatesAsync(LOCATION_TASK,{
      ...options,
      foregroundService:{
        notificationTitle:'Cardio em andamento',
        notificationBody:'O Consta registra seu percurso. Abra o app para pausar ou finalizar.',
        notificationColor:'#72a68b',killServiceOnDestroy:true,
      },
      pausesUpdatesAutomatically:false,
    });
    current.backgroundEnabled=true;
  }else if(background){
    const permission=await Location.requestBackgroundPermissionsAsync();
    if(!permission.granted)throw new ApiError('O registro com tela bloqueada não foi autorizado. Inicie sem essa opção ou ajuste a permissão nos Ajustes.','BACKGROUND_LOCATION_DENIED');
    await Location.startLocationUpdatesAsync(LOCATION_TASK,{
      ...options,showsBackgroundLocationIndicator:true,
      activityType:current.modality==='cycling'?Location.ActivityType.OtherNavigation:Location.ActivityType.Fitness,
      pausesUpdatesAutomatically:false,
    });
    current.backgroundEnabled=true;
  }else{
    foregroundWatch=await Location.watchPositionAsync(options,
      point=>{void locked(()=>acceptLocations([point])).catch(error=>{lastError=String(error);emit();});},
      reason=>{void locked(async()=>{if(!current)return;accrue();current.status='interrupted';current.signal='permission_denied';current.eligibilityReason='Localização interrompida. Nenhum trecho será estimado.';lastError=reason;await persist();emit();});},
    );
    current.backgroundEnabled=false;
  }
}
async function beginSteps(){
  if(!current||!current.stepsEnabled||current.modality==='cycling')return;
  const id=current.clientId;
  const base=current.steps??0;
  const response=await startSessionSteps(current.modality as CardioModality,update=>{
    void locked(async()=>{
      if(!current||current.clientId!==id||current.status!=='recording')return;
      current.steps=base+update.steps;
      current.stepsReliable=current.stepsReliable&&update.reliable;
      current.stepSource=update.source;
      current.stepsLastSyncedAt=update.lastSyncedAt;
      await persist();emit();
    });
  });
  stepWatch=response;
  if(!response.available){
    current.steps=null;current.stepSource=null;current.stepsReliable=false;
    lastError=response.message;
  }else{
    current.steps=current.steps??0;
    current.stepSource='Pedômetro do aparelho';
    current.stepsLastSyncedAt=new Date().toISOString();
  }
}
function freshActivity(modality:Modality,source:StoredActivity['source'],environment:Environment):StoredActivity{
  const id=Crypto.randomUUID();
  return {
    id,clientId:id,ownerId:ownerId(),serverId:null,modality,source,environment,
    startedAt:new Date().toISOString(),endedAt:null,status:'recording',syncStatus:'device_only',
    distanceMeters:0,activeSeconds:0,totalSeconds:0,pauseSeconds:0,
    steps:null,stepsReliable:true,stepSource:null,stepsLastSyncedAt:null,
    signal:'searching',eligibilityReason:null,notes:'',pointCount:0,backgroundEnabled:false,
    segment:0,filterSnapshot:null,runtimeId,lastTickAt:Date.now(),lastMonotonic:monotonic(),
    endedOffline:false,stepsEnabled:false,
  };
}
export async function initializeTracking():Promise<void>{
  if(initialized)return;
  const userId=ownerId();
  initialized=true;
  await locked(async()=>{
    const id=await getActiveId();
    if(id){
      const existing=await readActivity(id,userId);
      if(existing){
        current=existing;route=await readRoute(id,existing.ownerId);
        filter=new GpsFilter(existing.modality as CardioModality);
        if(existing.filterSnapshot)filter.restore(existing.filterSnapshot as ReturnType<GpsFilter['snapshot']>);
        if(existing.runtimeId!==runtimeId&&['recording','paused'].includes(existing.status)){
          current.status='interrupted';current.signal='lost';current.stepsReliable=false;
          current.eligibilityReason='Uma sessão foi recuperada do aparelho. O intervalo sem registro não foi acrescentado.';
          filter.pause();current.segment++;current.filterSnapshot=filter.snapshot();
          await stopNativeLocation();await persist();
        }
      }
    }
    emit();ensureTimer();
  });
  const appStateSubscription=AppState.addEventListener('change',state=>{
    void locked(async()=>{
      if(!current)return;
      if(state!=='active'){
        if(current.steps!==null){current.stepsReliable=false;}
        if(!current.backgroundEnabled&&current.status==='recording'){
          accrue();current.status='interrupted';filter?.pause();current.segment++;
          current.filterSnapshot=filter?.snapshot()??null;
          current.eligibilityReason='Registro em primeiro plano interrompido. Retome ao voltar ao aplicativo.';
          stepWatch?.stop();stepWatch=null;
        }
        await persist();emit();
      }else{
        accrue();
        const permission=await Location.getForegroundPermissionsAsync();
        if(!permission.granted&&current.status==='recording'){
          current.status='interrupted';current.signal='permission_denied';
          current.eligibilityReason='Permissão de localização revogada. Nenhum trecho foi estimado.';
          await stopNativeLocation();await persist();
        }
        emit();
      }
    }).catch(error=>{lastError=error instanceof Error?error.message:'Não foi possível persistir a interrupção.';emit();});
  });
  removeAppState=()=>appStateSubscription.remove();
  removeNetwork=NetInfo.addEventListener(state=>{
    if(state.isConnected&&getSession())void syncPendingActivities().catch(()=>{});
  });
}
export async function startCardio(modality:CardioModality,options:{background?:boolean;steps?:boolean}={}):Promise<LocalActivity>{
  return locked(async()=>{
    if(current&&['recording','paused','interrupted','review'].includes(current.status))throw new ApiError('Finalize ou descarte a sessão atual antes de iniciar outra.','SESSION_EXISTS');
    if(!['walking','running','cycling'].includes(modality))throw new ApiError('Modalidade de GPS inválida.','INVALID_MODALITY');
    await requestForegroundLocation();
    lastError=null;route=[];filter=new GpsFilter(modality);
    current=freshActivity(modality,'gps','outdoor');
    current.stepsEnabled=!!options.steps&&modality!=='cycling';
    const network=await NetInfo.fetch();
    if(network.isConnected){
      try{
        const start=await api<{id:string;startedAt:string;serverTime?:string}>('activities/start',{method:'POST',body:{clientId:current.clientId,modality,source:'gps',environment:'outdoor'}});
        current.serverId=start.id;current.startedAt=start.startedAt;
      }catch(error){
        if(!(error instanceof ApiError)||!['NETWORK_ERROR','CONFIGURATION_REQUIRED'].includes(error.code)){current=null;throw error;}
        current.eligibilityReason='Iniciada sem confirmação do servidor. Será preservada no histórico e poderá precisar de revisão para pontuar.';
      }
    }else current.eligibilityReason='Iniciada offline. Horário não validado para pontuação; histórico será preservado.';
    resetClock();await putActivity(current);await setActiveId(current.clientId);
    try{await beginNativeLocation(options.background??(Platform.OS==='android'));await beginSteps();}
    catch(error){
      await stopNativeLocation();
      await removeActivity(current.clientId,current.ownerId);await setActiveId(null);current=null;filter=null;
      throw error;
    }
    await persist();ensureTimer();emit();
    return publicActivity(current);
  });
}
export async function pauseCardio():Promise<void>{
  await locked(async()=>{
    if(!current||current.status!=='recording')return;
    accrue();if(current.status==='interrupted'){await persist();emit();return;}
    current.status='paused';current.segment++;filter?.pause();current.filterSnapshot=filter?.snapshot()??null;
    stepWatch?.stop();stepWatch=null;await persist();emit();
  });
}
export async function resumeCardio():Promise<void>{
  await locked(async()=>{
    if(!current||!['paused','interrupted'].includes(current.status))return;
    if(current.ownerId!==ownerId())throw new ApiError('Esta sessão pertence a outra conta.','FORBIDDEN',403);
    await requestForegroundLocation();
    if(current.status==='paused')accrue();
    const restart=current.status==='interrupted';
    if(restart){await stopNativeLocation();await beginNativeLocation(current.backgroundEnabled);}
    resetClock();current.status='recording';current.segment++;filter?.resume();
    current.filterSnapshot=filter?.snapshot()??null;current.signal='searching';
    await beginSteps();await persist();emit();
  });
}
export async function finishCardio():Promise<LocalActivity>{
  return locked(async()=>{
    if(!current||!['recording','paused','interrupted'].includes(current.status))throw new ApiError('Nenhuma sessão em andamento.','NO_SESSION');
    accrue();await stopNativeLocation();current.status='review';current.endedAt=new Date().toISOString();
    const network=await NetInfo.fetch();current.endedOffline=!network.isConnected;
    current.filterSnapshot=filter?.snapshot()??null;
    await persist();emit();return publicActivity(current);
  });
}
export async function saveCardio(notes=''):Promise<LocalActivity>{
  const result=await locked(async()=>{
    if(!current||current.status!=='review')throw new ApiError('Finalize a sessão antes de salvar.','REVIEW_REQUIRED');
    current.notes=notes.trim().slice(0,2000);current.status='saved';current.syncStatus='pending';
    await enqueue(current);await setActiveId(null);const result=publicActivity(current);emit();return result;
  });
  void syncPendingActivities().catch(()=>{});
  return result;
}
export async function discardCardio():Promise<void>{
  await locked(async()=>{
    if(!current)return;
    await stopNativeLocation();
    // Server start rows carry no completed points; attempt cleanup without blocking local discard.
    if(current.serverId)try{await api('activities/'+current.serverId,{method:'DELETE'});}catch{/* Remains incomplete and cannot score. */}
    await removeActivity(current.clientId,current.ownerId);await setActiveId(null);
    current=null;filter=null;route=[];lastError=null;emit();
  });
}
export async function listLocalActivities():Promise<LocalActivity[]>{
  return (await readActivities(ownerId())).filter(activity=>!activity.pendingDelete).map(publicActivity);
}
export async function getActivityRoute(clientId:string):Promise<RoutePoint[]>{
  return readRoute(clientId,ownerId());
}
export async function deleteLocalActivity(clientId:string):Promise<void>{
  await locked(async()=>{
    const activity=await readActivity(clientId,ownerId());
    if(!activity)return;
    if(current?.clientId===clientId){await stopNativeLocation();await setActiveId(null);current=null;filter=null;route=[];}
    await deleteRoute(clientId);
    if(activity.serverId){
      activity.pendingDelete=true;activity.syncStatus='pending';activity.pointCount=0;
      await enqueue(activity);
    }else await removeActivity(clientId,ownerId());
    emit();
  });
  void syncPendingActivities().catch(()=>{});
}
export async function saveManualActivity(input:{modality:Modality;durationMinutes:number;distanceKm?:number;environment?:Environment;notes?:string}):Promise<LocalActivity>{
  const allowed:Modality[]=['walking','running','cycling','strength','football','basketball','volleyball','other'];
  if(!allowed.includes(input.modality)||!Number.isFinite(input.durationMinutes)||input.durationMinutes<=0||input.durationMinutes>24*60)throw new ApiError('Informe modalidade e duração válidas.','INVALID_ACTIVITY');
  if(input.distanceKm!==undefined&&(!Number.isFinite(input.distanceKm)||input.distanceKm<0||input.distanceKm>1000||!['walking','running','cycling'].includes(input.modality)))throw new ApiError('Distância manual inválida para esta modalidade.','INVALID_DISTANCE');
  const activity=freshActivity(input.modality,'manual',input.environment??'outdoor');
  activity.activeSeconds=input.durationMinutes*60;activity.totalSeconds=activity.activeSeconds;
  activity.distanceMeters=(input.distanceKm??0)*1000;
  activity.endedAt=new Date().toISOString();
  activity.startedAt=new Date(Date.now()-activity.totalSeconds*1000).toISOString();
  activity.status='saved';activity.syncStatus='pending';activity.notes=input.notes?.trim().slice(0,2000)??'';
  activity.signal='lost';activity.stepsReliable=false;activity.endedOffline=true;
  activity.eligibilityReason='Registro manual de duração/distância. Sem medição GPS e sem horário autoritativo de início; elegibilidade depende do regulamento e revisão.';
  await enqueue(activity);emit();void syncPendingActivities().catch(()=>{});
  return publicActivity(activity);
}
export async function syncPendingActivities():Promise<void>{
  if(syncQueue)return syncQueue;
  syncQueue=(async()=>{
    const owner=ownerId();
    const network=await NetInfo.fetch();if(!network.isConnected)return;
    syncing=true;emit();
    try{
      for(const id of await queued(owner)){
        const activity=await readActivity(id,owner);if(!activity)continue;
        if(activity.pendingDelete){
          try{
            if(activity.serverId)await api('activities/'+activity.serverId,{method:'DELETE'});
            await removeActivity(id,owner);
          }catch(error){
            if(error instanceof ApiError&&error.status===404)await removeActivity(id,owner);
            else{await markAttempt(id,error instanceof ApiError?error.code:'DELETE_SYNC_ERROR');if(error instanceof ApiError&&error.code==='NETWORK_ERROR')break;}
          }
          continue;
        }
        const payload={
          clientId:activity.clientId,activeSeconds:Math.floor(activity.activeSeconds),
          totalSeconds:Math.floor(activity.totalSeconds),distanceMeters:Math.round(activity.distanceMeters),
          steps:activity.modality!=='cycling'&&activity.stepsReliable?activity.steps??undefined:undefined,
          completed:true,endedAt:activity.endedAt,notes:activity.notes||undefined,
          completedOffline:activity.endedOffline,
          anomalies:activity.eligibilityReason?.includes('simulada')?['mock_location']:undefined,
        };
        try{
          const response=activity.serverId
            ? await api<{id:string;eligibility?:string;ineligibleReason?:string}>('activities/'+activity.serverId+'/complete',{method:'POST',body:payload})
            : await api<{id:string;eligibility?:string;ineligibleReason?:string}>('activities/import',{method:'POST',body:{...payload,modality:activity.modality,source:activity.source,environment:activity.environment,startedAt:activity.startedAt}});
          activity.serverId=response.id??activity.serverId;
          activity.syncStatus=response.eligibility==='ineligible'?'ineligible':'server_confirmed';
          activity.eligibilityReason=response.ineligibleReason??(response.eligibility==='pending_review'?'Atividade salva no servidor, aguardando revisão de elegibilidade.':null);
          await acknowledge(activity);
          if(current?.clientId===id)current=activity;
        }catch(error){
          const code=error instanceof ApiError?error.code:'SYNC_ERROR';
          await markAttempt(id,code);
          if(error instanceof ApiError&&(error.status===401||error.code==='NETWORK_ERROR'))break;
          // Validation errors remain stored and queued until corrected/reviewed.
          activity.eligibilityReason=error instanceof Error?error.message:'Sincronização pendente.';
          await putActivity(activity);
          lastError=activity.eligibilityReason;
        }
      }
    }finally{syncing=false;emit();}
  })();
  try{await syncQueue;}finally{syncQueue=null;}
}
registerSessionCleanup(async action=>{
  await locked(async()=>{
    const owner=getSession()?.user.id;
    if(current){
      accrue();await stopNativeLocation();
      if(['recording','paused'].includes(current.status))current.status='interrupted';
      current.stepsReliable=false;
      await persist();
    }
    if(action==='delete'&&owner){await deleteOwnerData(owner);await setActiveId(null);}
    current=null;route=[];filter=null;lastError=null;initialized=false;
    removeAppState?.();removeAppState=null;removeNetwork?.();removeNetwork=null;
    if(timer){clearInterval(timer);timer=null;}emit();
  });
});
