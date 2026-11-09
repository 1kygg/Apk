import { describe,it,expect } from 'vitest';
import {advanceRecordingClock,activityMetrics,addActivityAnomaly} from './recording-model';
import type {StoredActivity} from './storage';
function activity(overrides:Partial<StoredActivity>={}):StoredActivity{return{
  id:'a',clientId:'a',ownerId:'u',serverId:null,modality:'walking',source:'gps',environment:'outdoor',
  startedAt:'2026-01-01T00:00:00Z',endedAt:null,status:'recording',syncStatus:'device_only',
  distanceMeters:0,activeSeconds:0,totalSeconds:0,pauseSeconds:0,steps:null,stepsReliable:true,
  stepSource:null,stepsLastSyncedAt:null,signal:'searching',eligibilityReason:null,notes:'',pointCount:0,
  backgroundEnabled:false,anomalies:[],segment:0,filterSnapshot:null,runtimeId:'process-1',lastTickAt:1000,lastMonotonic:1000,
  endedOffline:false,stepsEnabled:false,...overrides,
};}
describe('native recording clock without native sensor claims',()=>{
  it('counts active duration only while recording',()=>{
    const active=advanceRecordingClock(activity(),6000,6000,'process-1');
    expect(active.activeSeconds).toBe(5);expect(active.totalSeconds).toBe(5);
    const paused=advanceRecordingClock({...active,status:'paused'},11000,11000,'process-1');
    expect(paused.activeSeconds).toBe(5);expect(paused.totalSeconds).toBe(10);expect(paused.pauseSeconds).toBe(5);
  });
  it('counts explicit long pauses in the same process without adding active time',()=>{
    const paused=advanceRecordingClock(activity({status:'paused'}),601000,601000,'process-1');
    expect(paused.status).toBe('paused');expect(paused.pauseSeconds).toBe(600);expect(paused.activeSeconds).toBe(0);
  });
  it('does not fabricate an unobserved interval after process termination',()=>{
    const recovered=advanceRecordingClock(activity({activeSeconds:12}),50000,100,'process-2');
    expect(recovered.status).toBe('interrupted');expect(recovered.activeSeconds).toBe(12);expect(recovered.stepsReliable).toBe(false);
  });
  it('interrupts on clock changes and excessive recording gaps',()=>{
    expect(advanceRecordingClock(activity(),-1,2000,'process-1').status).toBe('interrupted');
    expect(advanceRecordingClock(activity(),50000,50000,'process-1').activeSeconds).toBe(0);
    expect(advanceRecordingClock(activity(),11000,2000,'process-1').status).toBe('interrupted');
  });
  it('retains saved and review records unchanged',()=>{
    for(const status of ['review','saved'] as const){
      const source=activity({status});expect(advanceRecordingClock(source,500000,500000,'other')).toBe(source);
    }
  });
  it('defines pace and cycling speed using active duration',()=>{
    expect(activityMetrics({distanceMeters:5000,activeSeconds:1800})).toEqual({kilometers:5,paceSecondsPerKm:360,speedKmh:10,timingBasis:'active'});
    expect(activityMetrics({distanceMeters:0,activeSeconds:0}).paceSecondsPerKm).toBeNull();
  });
});

describe('durable integrity metadata',()=>{
  it('retains mocked-location flags through interruption and changing UI reasons',()=>{
    const marked=addActivityAnomaly(activity(),'mock_location');
    const interrupted=advanceRecordingClock(marked,50000,50000,'other-process');
    const completed={...interrupted,status:'saved' as const,eligibilityReason:'Sincronização pendente.'};
    expect(completed.anomalies).toEqual(['mock_location']);
    expect(addActivityAnomaly(completed,'mock_location').anomalies).toEqual(['mock_location']);
  });
});
