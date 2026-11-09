import {DatabaseSync} from 'node:sqlite';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({db:null as any,deletedFiles:[] as string[]}));
vi.mock('expo-crypto',()=>({randomUUID:()=>globalThis.crypto.randomUUID()}));
vi.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///test-documents/',deleteAsync:async(path:string)=>{state.deletedFiles.push(path);}}));
vi.mock('expo-sqlite',()=>{
 const adapter={
  execAsync:async(sql:string)=>{state.db.exec(sql);},
  runAsync:async(sql:string,...p:any[])=>state.db.prepare(sql).run(...p),
  getFirstAsync:async(sql:string,...p:any[])=>state.db.prepare(sql).get(...p)??null,
  getAllAsync:async(sql:string,...p:any[])=>state.db.prepare(sql).all(...p),
  withTransactionAsync:async(action:()=>Promise<void>)=>{state.db.exec('BEGIN');try{await action();state.db.exec('COMMIT');}catch(e){state.db.exec('ROLLBACK');throw e;}},
  withExclusiveTransactionAsync:async(action:(tx:any)=>Promise<void>)=>{state.db.exec('BEGIN');try{await action(adapter);state.db.exec('COMMIT');}catch(e){state.db.exec('ROLLBACK');throw e;}},
 };
 return{openDatabaseAsync:async()=>adapter};
});
let auth:typeof import('./auth');
beforeEach(async()=>{vi.resetModules();state.db=new DatabaseSync(':memory:');state.deletedFiles=[];vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Network is forbidden in local profiles');}));auth=await import('./auth');});
afterEach(()=>{state.db.close();vi.unstubAllGlobals();});
describe('real SQLite local profile lifecycle; no Google, network or verified identity',()=>{
 it('creates a named profile/photo and restores it on a cold application start',async()=>{
  const created=await auth.createLocalProfile({displayName:'  Joana  ',avatarUri:'file:///test-documents/foto.jpg'});
  expect(created.user.displayName).toBe('Joana');expect(created).not.toHaveProperty('accessToken');expect(created.local).toBe(true);
  vi.resetModules();const reopened=await import('./auth');expect((await reopened.restoreSession())?.user).toEqual(created.user);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('does not create duplicate local profiles on simultaneous button presses',async()=>{
  const results=await Promise.allSettled([auth.createLocalProfile({displayName:'Ana'}),auth.createLocalProfile({displayName:'Bia'})]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.find(x=>x.status==='rejected')).toMatchObject({reason:{code:'PROFILE_EXISTS'}});
 });
 it('updates the name and photo locally without requesting an identity token',async()=>{
  const created=await auth.createLocalProfile({displayName:'Inicial'});const {api}=await import('./api');
  await api('/me',{method:'PATCH',body:{displayName:'Novo nome',avatarUrl:'file:///test-documents/nova.jpg'}});
  expect(auth.getSession()?.user).toMatchObject({id:created.user.id,displayName:'Novo nome',avatarUrl:'file:///test-documents/nova.jpg'});
  expect((await auth.restoreSession())?.user.displayName).toBe('Novo nome');expect(fetch).not.toHaveBeenCalled();
 });
 it('deletes profile/history/score settings and cleans notifications before other data',async()=>{
  const created=await auth.createLocalProfile({displayName:'Perfil'});const {api}=await import('./api');const storage=await import('./storage');const scope=await import('./account-scope');const old=scope.captureAccountScope();
  await storage.setLocalPreference('local-score-rules.'+created.user.id,{weeklyCap:5});
  const end=new Date(),start=new Date(end.getTime()-60000);
  await api('/activities/import',{method:'POST',body:{clientId:globalThis.crypto.randomUUID(),source:'manual',modality:'football',environment:'outdoor',activeSeconds:60,startedAt:start.toISOString(),endedAt:end.toISOString()}});
  const events:string[]=[];auth.registerSessionCleanup(async()=>{events.push('capture');});auth.registerSessionCleanup(async()=>{events.push('notifications');},-10);
  await auth.deleteAccount();expect(events).toEqual(['notifications','capture']);expect(auth.getSession()).toBeNull();expect(()=>scope.assertAccountScope(old)).toThrow();
  expect(await auth.restoreSession()).toBeNull();expect(await storage.getLocalPreference('local-profile.v1')).toBeNull();expect(await storage.getLocalPreference('local-score-rules.'+created.user.id)).toBeNull();
  expect(state.db.prepare('SELECT COUNT(*) AS n FROM device_activity_summaries').get().n).toBe(0);
  expect(state.deletedFiles).toContain('file:///test-documents/consta-avatars/');expect(fetch).not.toHaveBeenCalled();
  expect((await auth.createLocalProfile({displayName:'Outro perfil'})).user.id).not.toBe(created.user.id);
 });
 it('rejects an empty name, an online photo URL and access through another profile',async()=>{
  await expect(auth.createLocalProfile({displayName:'  '})).rejects.toMatchObject({code:'INVALID_PROFILE'});
  await expect(auth.createLocalProfile({displayName:'Nome',avatarUri:'https://example.invalid/foto.jpg'})).rejects.toMatchObject({code:'INVALID_AVATAR'});
  await auth.createLocalProfile({displayName:'Nome'});const {api}=await import('./api');
  await expect(api('/activities',{expectedUserId:'another-profile'})).rejects.toMatchObject({code:'ACCOUNT_CHANGED'});expect(fetch).not.toHaveBeenCalled();
 });
});
