import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const native=vi.hoisted(()=>({
  uuid:0, watch:null as null|((point:any)=>void),
  requestPermission:vi.fn(async()=>({granted:true})),
  networkRead:vi.fn(async()=>{throw new Error('Cardio local não pode depender da rede.');}),
}));
vi.mock('react-native',()=>({Platform:{OS:'android'},AppState:{currentState:'active',addEventListener:()=>({remove:()=>{}})}}));
vi.mock('@react-native-community/netinfo',()=>({default:{fetch:native.networkRead,addEventListener:native.networkRead}}));
vi.mock('expo-crypto',()=>({randomUUID:()=> '00000000-0000-4000-8000-'+String(++native.uuid).padStart(12,'0')}));
vi.mock('expo-location',()=>({
  Accuracy:{High:6},ActivityType:{Fitness:1,OtherNavigation:2},
  requestForegroundPermissionsAsync:native.requestPermission,
  getForegroundPermissionsAsync:async()=>({granted:true}),hasServicesEnabledAsync:async()=>true,
  hasStartedLocationUpdatesAsync:async()=>false,stopLocationUpdatesAsync:async()=>{},
  watchPositionAsync:async(_options:any,callback:(point:any)=>void)=>{native.watch=callback;return {remove:()=>{native.watch=null;}};},
}));
vi.mock('expo-task-manager',()=>({isTaskDefined:()=>false,defineTask:()=>{}}));
vi.mock('./steps',()=>({startSessionSteps:async()=>({available:false,message:'Sensor não verificado neste teste',stop:()=>{}})}));
vi.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///test/',deleteAsync:async()=>{}}));
vi.mock('expo-sqlite',async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  return {openDatabaseAsync:async()=>{
    const sqlite=new DatabaseSync(':memory:');
    const adapter={
      execAsync:async(sql:string)=>{sqlite.exec(sql);},
      runAsync:async(sql:string,...params:any[])=>sqlite.prepare(sql).run(...params),
      getFirstAsync:async(sql:string,...params:any[])=>sqlite.prepare(sql).get(...params)??null,
      getAllAsync:async(sql:string,...params:any[])=>sqlite.prepare(sql).all(...params),
      withExclusiveTransactionAsync:async(action:(transaction:any)=>Promise<void>)=>{
        sqlite.exec('BEGIN');try{await action(adapter);sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}
      },
      withTransactionAsync:async(action:()=>Promise<void>)=>{
        sqlite.exec('BEGIN');try{await action();sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}
      },
    };
    return adapter;
  }};
});

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
beforeEach(()=>{
  vi.resetModules();native.uuid=0;native.watch=null;native.requestPermission.mockClear();native.networkRead.mockClear();
  vi.useFakeTimers({toFake:['Date','performance','setInterval','clearInterval']});
  vi.setSystemTime(new Date('2026-11-09T12:00:00.000Z'));
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Nenhuma chamada HTTP é esperada.');}));
});
afterEach(async()=>{
  const auth=await import('./auth');if(auth.getSession())await auth.deleteAccount();
  vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
});
async function profile(){
  const auth=await import('./auth');await auth.createLocalProfile({displayName:'Perfil do teste local'});
  const tracking=await import('./tracking');await tracking.initializeTracking();return tracking;
}
function position(latitude:number){return {timestamp:Date.now(),mocked:false,coords:{latitude,longitude:-46.63,accuracy:5,altitude:null,altitudeAccuracy:null,heading:null,speed:null}};}

describe('cardio offline com SQLite real e adaptadores nativos controlados; não verifica sensores',()=>{
  it('salva esporte manual, recalcula o histórico imediatamente e não consulta rede ou GPS',async()=>{
    const tracking=await profile();
    const saved=await tracking.saveManualActivity({modality:'football',durationMinutes:20,environment:'outdoor'});
    expect(saved.syncStatus).toBe('local_saved');
    const {api}=await import('./api');
    const history=await api<{items:any[]}>('/activities');
    expect(history.items).toHaveLength(1);expect(history.items[0]).toMatchObject({modality:'football',status:'completed',eligibility:'local_only',activeSeconds:1200});
    expect(history.items[0].distanceMeters).toBeUndefined();
    await tracking.syncPendingActivities();await tracking.syncPendingActivities();
    expect((await api<{items:any[]}>('/activities')).items).toHaveLength(1);
    expect(native.requestPermission).not.toHaveBeenCalled();expect(native.networkRead).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it('mede segmentos válidos, interrompe a distância na pausa e conclui sem internet',async()=>{
    const tracking=await profile();
    await tracking.startCardio('walking',{background:false,steps:false});
    native.watch!(position(-23.55));await flush();
    await vi.advanceTimersByTimeAsync(20000);
    native.watch!(position(-23.5497));await flush();
    const beforePause=tracking.getTracker().activity!.distanceMeters;expect(beforePause).toBeGreaterThan(30);
    await tracking.pauseCardio();await vi.advanceTimersByTimeAsync(5000);
    native.watch!(position(-23.545));await flush();
    expect(tracking.getTracker().activity!.distanceMeters).toBe(beforePause);
    await tracking.resumeCardio();native.watch!(position(-23.545));await flush();
    await vi.advanceTimersByTimeAsync(10000);native.watch!(position(-23.5449));await flush();
    await tracking.finishCardio();const saved=await tracking.saveCardio('Registro local');
    expect(saved.distanceMeters).toBeGreaterThan(42);expect(saved.distanceMeters).toBeLessThan(46);
    expect(saved.activeSeconds).toBe(30);expect(saved.totalSeconds).toBe(35);expect(saved.syncStatus).toBe('local_saved');
    const {api}=await import('./api');const activity=(await api<{items:any[]}>('/activities')).items[0];
    expect(activity).toMatchObject({eligibility:'local_only',status:'completed',source:'gps',notes:'Registro local'});
    expect(native.networkRead).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it('preserva o registro sem inventar tempo quando o relógio muda',async()=>{
    const tracking=await profile();await tracking.startCardio('walking',{background:false});
    await vi.advanceTimersByTimeAsync(5000);const previous=tracking.getTracker().activity!;
    vi.setSystemTime(Date.now()+60000);await tracking.pauseCardio();
    expect(tracking.getTracker().activity).toMatchObject({status:'interrupted',activeSeconds:previous.activeSeconds,distanceMeters:previous.distanceMeters});
    await tracking.finishCardio();const saved=await tracking.saveCardio();expect(saved.syncStatus).toBe('local_saved');
  });
  it('consolida um novo registro mesmo quando outro lote já tirou seu snapshot',async()=>{
    const tracking=await profile(),storage=await import('./storage');
    const originalQueued=storage.queued,originalEnqueue=storage.enqueue;
    let snapshotReady!:()=>void,release!:()=>void,enqueued!:()=>void;
    const snapshot=new Promise<void>(resolve=>{snapshotReady=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const queuedNew=new Promise<void>(resolve=>{enqueued=resolve;});
    vi.spyOn(storage,'queued').mockImplementationOnce(async owner=>{const ids=await originalQueued(owner);snapshotReady();await gate;return ids;});
    vi.spyOn(storage,'enqueue').mockImplementationOnce(async activity=>{await originalEnqueue(activity);enqueued();});
    const previous=tracking.syncPendingActivities();await snapshot;
    const save=tracking.saveManualActivity({modality:'football',durationMinutes:20});await queuedNew;release();
    await Promise.all([previous,save]);
    const {api}=await import('./api');expect((await api<{items:any[]}>('/activities')).items).toHaveLength(1);
    expect((await tracking.listLocalActivities())[0].syncStatus).toBe('local_saved');
  });
  it('exclui uma conclusão já gravada mesmo quando a confirmação local foi perdida',async()=>{
    const tracking=await profile(),storage=await import('./storage');
    vi.spyOn(storage,'acknowledge').mockRejectedValueOnce(new Error('Falha ao confirmar gravação local'));
    await expect(tracking.saveManualActivity({modality:'football',durationMinutes:20})).rejects.toThrow('Falha ao confirmar');
    const {api}=await import('./api');expect((await api<{items:any[]}>('/activities')).items).toHaveLength(1);
    const capture=(await tracking.listLocalActivities())[0];
    // A process can die after the summary commit and before either ACK or its
    // catch handler saves the returned ID. Reproduce that persisted boundary.
    const original=await storage.readActivity(capture.clientId,capture.ownerId);
    await storage.putActivity({...original!,serverId:null});
    const pending=(await tracking.listLocalActivities())[0];expect(pending.serverId).toBeNull();
    await tracking.deleteLocalActivity(pending.clientId);
    expect((await api<{items:any[]}>('/activities')).items).toHaveLength(0);expect(await tracking.listLocalActivities()).toEqual([]);
  });
  it('permite tentar salvar novamente quando a fila local não pode ser gravada',async()=>{
    const tracking=await profile();await tracking.startCardio('walking',{background:false});
    await vi.advanceTimersByTimeAsync(5000);await tracking.finishCardio();
    const storage=await import('./storage');vi.spyOn(storage,'enqueue').mockRejectedValueOnce(new Error('Armazenamento indisponível'));
    await expect(tracking.saveCardio()).rejects.toThrow('Armazenamento indisponível');
    expect(tracking.getTracker().activity?.status).toBe('review');
    expect((await tracking.saveCardio()).syncStatus).toBe('local_saved');
  });
  it('permite finalizar novamente após falha na persistência da revisão, sem inventar tempo ativo',async()=>{
    const tracking=await profile();await tracking.startCardio('walking',{background:false});await vi.advanceTimersByTimeAsync(5000);
    const storage=await import('./storage');vi.spyOn(storage,'putActivity').mockRejectedValueOnce(new Error('Armazenamento indisponível'));
    await expect(tracking.finishCardio()).rejects.toThrow('Armazenamento indisponível');
    expect(tracking.getTracker().activity).toMatchObject({status:'interrupted',activeSeconds:5});
    await tracking.finishCardio();expect((await tracking.saveCardio()).activeSeconds).toBe(5);
  });
  it('retoma a recuperação após uma falha transitória ao ler o percurso preservado',async()=>{
    const auth=await import('./auth');const session=await auth.createLocalProfile({displayName:'Perfil local'});
    const storage=await import('./storage');const id='00000000-0000-4000-8000-999999999999';
    const saved={id,clientId:id,ownerId:session.user.id,serverId:null,modality:'walking',source:'gps',environment:'outdoor',
      startedAt:new Date().toISOString(),endedAt:null,status:'recording',syncStatus:'device_only',distanceMeters:0,activeSeconds:0,totalSeconds:0,pauseSeconds:0,
      steps:null,stepsReliable:false,stepSource:null,stepsLastSyncedAt:null,signal:'lost',eligibilityReason:null,notes:'',pointCount:0,anomalies:[],backgroundEnabled:false,
      segment:0,filterSnapshot:null,runtimeId:'previous-process',lastTickAt:Date.now(),lastMonotonic:0,endedOffline:false,stepsEnabled:false};
    await storage.putActivity(saved as import('./storage').StoredActivity);await storage.setActiveId(id,session.user.id);
    vi.spyOn(storage,'readRoute').mockRejectedValueOnce(new Error('Leitura temporariamente indisponível'));
    const tracking=await import('./tracking');await expect(tracking.initializeTracking()).rejects.toThrow('Leitura temporariamente');
    await tracking.initializeTracking();expect(tracking.getTracker().activity).toMatchObject({clientId:id,status:'interrupted',activeSeconds:0});
  });

});
