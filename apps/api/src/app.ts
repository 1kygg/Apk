import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { Pool } from 'pg';
import { readConfig,hasSigningKey } from './config.js';
import type { ApiConfig } from './config.js';
import { installErrors } from './errors.js';
import { createAuthService } from './services/auth.js';
import type { IdentityVerifier } from './services/auth.js';
import { createActivityService } from './services/activities.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerGroupRoutes } from './routes/groups.js';
import { registerChallengeRoutes } from './routes/challenges.js';
import { registerActivityRoutes } from './routes/activities.js';
import { registerPlanRoutes } from './routes/plans.js';
export interface BuildAppOptions {pool:Pool;verifyIdentity?:IdentityVerifier;config?:ApiConfig}
export async function buildApp({pool,verifyIdentity,config=readConfig()}:BuildAppOptions){
  // Logging request objects would expose tokens and private health information.
  const app=Fastify({logger:false,bodyLimit:450000,trustProxy:false});
  installErrors(app);
  app.setNotFoundHandler((_request,reply)=>reply.code(404).send({error:{code:'NOT_FOUND',message:'Recurso não encontrado.'}}));
  await app.register(rateLimit,{max:180,timeWindow:'1 minute'});
  app.decorateRequest('sessionFamilyId','');
  const auth=createAuthService(pool,config,verifyIdentity);
  const activities=createActivityService(pool);
  await app.register(async api=>{
    api.get('/health',async (_request,reply)=>{
      try{
        await pool.query('SELECT 1');
        const ready=hasSigningKey(config);
        return reply.code(ready?200:503).send({status:ready?'ok':'configuration_required',database:'ok',authentication:ready?'configured':'unconfigured'});
      }catch{return reply.code(503).send({status:'unavailable',database:'unavailable'});}
    });
    api.get('/config',async ()=>({
      name:'Consta',apiVersion:1,authenticationConfigured:hasSigningKey(config),
      providers:{google:hasSigningKey(config)&&config.googleClientIds.length>0,apple:hasSigningKey(config)&&config.appleClientIds.length>0},
      nativeBuildRequired:true,privacy:{routesUploaded:false,healthAdvertising:false},
      challengeTypes:['consistency','walking','running','cycling','steps'],
      activitySources:['self_reported','gps','manual','health_connect','healthkit'],
    }));
    const loginLimit={config:{rateLimit:{max:12,timeWindow:'1 minute'}}};
    api.post('/auth/google',loginLimit,async request=>{
      const {idToken}=z.object({idToken:z.string().min(1).max(12000)}).strict().parse(request.body);
      return auth.login('google',idToken);
    });
    api.post('/auth/apple/nonce',loginLimit,()=>auth.createNonce());
    api.post('/auth/apple',loginLimit,async request=>{
      const input=z.object({identityToken:z.string().min(1).max(12000),nonceId:z.string().uuid(),displayName:z.string().trim().min(1).max(80).optional()}).strict().parse(request.body);
      return auth.login('apple',input.identityToken,{nonceId:input.nonceId,displayName:input.displayName});
    });
    api.post('/auth/refresh',{config:{rateLimit:{max:40,timeWindow:'1 minute'}}},async request=>{
      const {refreshToken}=z.object({refreshToken:z.string().min(20).max(200)}).strict().parse(request.body);
      return auth.refresh(refreshToken);
    });
    api.post('/auth/logout',{preHandler:auth.authenticate},async request=>{
      const {refreshToken}=z.object({refreshToken:z.string().min(20).max(200).optional()}).strict().parse(request.body??{});
      await auth.logout(request.user.id,request.sessionFamilyId,refreshToken);
      return {loggedOut:true};
    });
    registerAccountRoutes(api,{pool,authenticate:auth.authenticate});
    registerGroupRoutes(api,{pool,authenticate:auth.authenticate});
    registerChallengeRoutes(api,{pool,authenticate:auth.authenticate});
    registerActivityRoutes(api,{pool,authenticate:auth.authenticate,service:activities});
    await registerPlanRoutes(api,{pool,authenticate:auth.authenticate,startActivity:activities.startActivity,completeActivity:activities.completeActivity});
  },{prefix:'/v1'});
  await app.ready();
  return app;
}
