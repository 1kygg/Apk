import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({memory:new Map<string,string>(),request:vi.fn()}));
vi.mock('expo-sqlite/kv-store',()=>({default:{getItem:async(key:string)=>mocks.memory.get(key)??null,setItem:async(key:string,value:string)=>{mocks.memory.set(key,value);}}}));
vi.mock('../lib/api',()=>({api:mocks.request}));
vi.mock('../lib/account-scope',()=>({captureAccountScope:(userId:string)=>({userId,epoch:7}),assertAccountScope:()=>{}}));
import {loadDrafts,saveDraft,SessionDraft,syncTrainingDrafts} from './trainingStore';
function draft(userId='owner-a',planId='plan-a'):SessionDraft{return {userId,planId,startedAt:'2026-11-08T10:00:00Z',finishedAt:'2026-11-08T10:10:20Z',activeSeconds:620,sets:{slot:[true]},adaptations:{slot:{sets:1,note:'Amplitude confortável'}},notes:'Sem dor',pendingFinish:true};}
describe('fila local de treinos autodeclarados',()=>{
 beforeEach(()=>{mocks.memory.clear();mocks.request.mockReset().mockResolvedValue({});});
 it('serializa gravações concorrentes e mantém um rascunho por sessão e conta',async()=>{
  await Promise.all([saveDraft(draft()),saveDraft({...draft(),notes:'Atualizado'}),saveDraft(draft('owner-b'))]);
  const items=await loadDrafts();expect(items).toHaveLength(2);expect(items.find(x=>x.userId==='owner-a')?.notes).toBe('Atualizado');
 });
 it('consolida somente o perfil solicitado e fixa seu identificador em cada requisição',async()=>{
  await saveDraft(draft());await saveDraft(draft('owner-b','plan-b'));
  expect(await syncTrainingDrafts('owner-a')).toBe(1);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  for(const call of mocks.request.mock.calls)expect(call[1].expectedUserId).toBe('owner-a');
  expect(await loadDrafts()).toEqual([draft('owner-b','plan-b')]);
 });
 it('preserva a conclusão local quando a gravação falha e permite reenvio sem duplicar a sessão',async()=>{
  await saveDraft(draft());mocks.request.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('storage failed'));
  await expect(syncTrainingDrafts('owner-a')).rejects.toThrow('storage failed');expect(await loadDrafts()).toHaveLength(1);
  mocks.request.mockResolvedValue({});expect(await syncTrainingDrafts('owner-a')).toBe(1);expect(await loadDrafts()).toHaveLength(0);
  expect(mocks.request.mock.calls.filter(x=>String(x[0]).endsWith('/finish')).map(x=>x[0])).toEqual(['/plans/plan-a/finish','/plans/plan-a/finish']);
 });
 it('não conclui nem pontua uma sessão ainda em execução',async()=>{
  await saveDraft({...draft(),pendingFinish:false});expect(await syncTrainingDrafts('owner-a')).toBe(0);expect(mocks.request).not.toHaveBeenCalled();expect(await loadDrafts()).toHaveLength(1);
 });
});

it('preserva o horário original da conclusão tanto imediata quanto recuperada',async()=>{
 mocks.memory.clear();mocks.request.mockReset().mockResolvedValue({});
 await saveDraft(draft());await syncTrainingDrafts('owner-a','plan-a');
 expect(mocks.request.mock.calls.find(x=>String(x[0]).endsWith('/finish'))?.[1].body).toMatchObject({endedAt:'2026-11-08T10:10:20Z'});
 mocks.request.mockClear();await saveDraft(draft());await syncTrainingDrafts('owner-a');
 expect(mocks.request.mock.calls.find(x=>String(x[0]).endsWith('/finish'))?.[1].body).toMatchObject({endedAt:'2026-11-08T10:10:20Z'});
});
