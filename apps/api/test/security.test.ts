import {describe,it,expect} from 'vitest';
import type {Pool} from 'pg';
import {buildApp} from '../src/app.js';
import {hashToken} from '../src/services/auth.js';
import {detectMetricAnomalies,startActivitySchema,completeActivitySchema} from '../src/services/activities.js';
import {hasSigningKey} from '../src/config.js';
const config={jwtSecret:'',googleClientIds:[],appleClientIds:[],issuer:'consta-api',audience:'consta-native'};
describe('configuration and input security (no external identity or native sensors)',()=>{
  it('requires at least 32 bytes of signing material',()=>{
    expect(hasSigningKey(config)).toBe(false);
    expect(hasSigningKey({...config,jwtSecret:'x'.repeat(31)})).toBe(false);
    expect(hasSigningKey({...config,jwtSecret:'x'.repeat(32)})).toBe(true);
  });
  it('hashes opaque credentials and keeps stable fingerprints',()=>{
    const raw='opaque-test-token-not-a-real-credential';
    expect(hashToken(raw)).not.toContain(raw);
    expect(hashToken(raw)).toHaveLength(64);
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw+'x')).not.toBe(hashToken(raw));
  });
  it('rejects a location route and forged server timestamps in API bodies',()=>{
    const start={clientId:'01a4be89-7ad4-43b5-a1e9-6cd4dfac17be',modality:'walking',source:'gps',environment:'outdoor'};
    expect(startActivitySchema.safeParse({...start,verifiedStartAt:new Date().toISOString()}).success).toBe(false);
    expect(completeActivitySchema.safeParse({activeSeconds:5,route:[{latitude:0,longitude:0}]}).success).toBe(false);
    expect(completeActivitySchema.safeParse({activeSeconds:5,eligibility:'verified'}).success).toBe(false);
  });
  it('flags implausible metrics without asserting physical proof',()=>{
    expect(detectMetricAnomalies('walking',600,600)).toEqual([]);
    expect(detectMetricAnomalies('walking',1,10000)).toContain('implausible_speed_requires_review');
    expect(detectMetricAnomalies('cycling',600,5000)).toEqual([]);
    expect(detectMetricAnomalies('running',0,100)).not.toEqual([]);
  });
  it('exposes configuration honestly and has no email or HTTP test login',async()=>{
    const app=await buildApp({pool:{} as Pool,config});
    try{
      const status=await app.inject({url:'/v1/config'});
      expect(status.statusCode).toBe(200);
      expect(status.json().providers).toEqual({google:false,apple:false});
      const email=await app.inject({method:'POST',url:'/v1/auth/google',payload:{email:'forged@example.invalid'}});
      expect(email.statusCode).toBe(400);
      const disabled=await app.inject({method:'POST',url:'/v1/auth/google',payload:{idToken:'untrusted'}});
      expect(disabled.statusCode).toBe(503);
      expect(disabled.json().error.code).toBe('AUTH_UNCONFIGURED');
      expect((await app.inject({method:'POST',url:'/v1/auth/test',payload:{userId:'1'}})).statusCode).toBe(404);
      expect((await app.inject({url:'/v1/me'})).statusCode).toBe(503);
    }finally{await app.close();}
  });
});
