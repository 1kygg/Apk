import Storage from 'expo-sqlite/kv-store';
import {api} from '../lib/api';
import {DayPlan} from './types';
export type SessionDraft = {planId:string;startedAt:string;activeSeconds:number;sets:Record<string,boolean[]>;adaptations:NonNullable<DayPlan['progress']>['adaptations'];notes:string;pendingFinish:boolean;finishedAt?:string;userId:string};
const key='consta.training.drafts.v1';
export async function loadDrafts():Promise<SessionDraft[]> {const raw=await Storage.getItem(key);if(!raw)return [];try{return JSON.parse(raw) as SessionDraft[];}catch{return [];}}
export async function loadDraft(planId:string,userId:string){return (await loadDrafts()).find(x=>x.planId===planId&&x.userId===userId)||null;}
let chain:Promise<unknown>=Promise.resolve();
export function saveDraft(draft:SessionDraft):Promise<void>{
  const task=chain.then(async()=>{const all=await loadDrafts();await Storage.setItem(key,JSON.stringify([...all.filter(x=>!(x.planId===draft.planId&&x.userId===draft.userId)),draft]));});chain=task.catch(()=>{});return task;
}
export function removeDraft(planId:string,userId:string):Promise<void>{
  const task=chain.then(async()=>{const all=await loadDrafts();await Storage.setItem(key,JSON.stringify(all.filter(x=>!(x.planId===planId&&x.userId===userId))));});chain=task.catch(()=>{});return task;
}
let syncing=false;
export async function syncTrainingDrafts(userId:string):Promise<number>{
  if(syncing)return 0;syncing=true;let count=0;
  try{for(const draft of await loadDrafts()){if(draft.userId!==userId||!draft.pendingFinish)continue;
    await api('/plans/'+draft.planId+'/progress',{method:'PATCH',body:{sets:draft.sets,adaptations:draft.adaptations,notes:draft.notes}});
    await api('/plans/'+draft.planId+'/finish',{method:'POST',body:{activeSeconds:Math.floor(draft.activeSeconds),notes:draft.notes,adaptations:draft.adaptations}});
    await removeDraft(draft.planId,userId);count++;
  }}finally{syncing=false;}return count;
}
