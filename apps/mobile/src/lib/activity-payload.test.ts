import {describe,it,expect} from 'vitest';
import {completeActivitySchema,importActivitySchema} from '../../../api/src/services/activities';
import {completionPayload,importPayload} from './activity-payload';
import {inviteLink,parseInvite} from './invites';
import type {StoredActivity} from './storage';
const fixture={clientId:'9146f7d8-cbd9-4db7-9e90-f491d7a6c530',modality:'walking',source:'gps',environment:'outdoor',activeSeconds:600,totalSeconds:720,distanceMeters:801.5,steps:500,stepsReliable:true,notes:'',startedAt:'2026-11-08T10:00:00.000Z',endedAt:'2026-11-08T10:12:00.000Z',endedOffline:true,anomalies:[],route:[{latitude:10,longitude:20}]} as unknown as StoredActivity;
describe('native summaries accepted by the actual server validators; no sensor verification',()=>{
  it('uses different completion and import contracts without leaking a route',()=>{
    const completion=completionPayload(fixture),imported=importPayload(fixture);
    expect(completeActivitySchema.safeParse(completion).success).toBe(true);
    expect(importActivitySchema.safeParse(imported).success).toBe(true);
    expect(completion).not.toHaveProperty('route');expect(imported).not.toHaveProperty('completedOffline');
    expect(imported.startedAt).toBe(fixture.startedAt);expect(imported.endedAt).toBe(fixture.endedAt);
  });
  it('registers sports by duration without an inapplicable zero-distance field',()=>{
    const payload=importPayload({...fixture,modality:'football',source:'manual'});
    expect(importActivitySchema.safeParse(payload).success).toBe(true);
    expect(payload).not.toHaveProperty('distanceMeters');expect(payload.steps).toBeUndefined();
  });
  it('omits partial steps and never publishes steps for cycling',()=>{
    expect(completionPayload({...fixture,stepsReliable:false}).steps).toBeUndefined();
    expect(completionPayload({...fixture,modality:'cycling'}).steps).toBeUndefined();
  });
  it('shares, opens and pastes the same revocable invitation code',()=>{
    const code='BbOdKHvp42djaeN6_Ab2DePJSEHH0_VG';
    expect(parseInvite(inviteLink(code))).toBe(code);expect(parseInvite(code)).toBe(code);
    expect(parseInvite('consta://invite?code='+code)).toBe(code);
    expect(parseInvite('https://unrelated.example/'+code)).toBeNull();
    expect(parseInvite('consta://invite/../../other')).toBeNull();
  });
});
