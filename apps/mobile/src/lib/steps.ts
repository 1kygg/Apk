import { AppState, Platform } from 'react-native';
import { Pedometer } from 'expo-sensors';
import { captureAccountScope,assertAccountScope } from './account-scope';
import type { CardioModality, StepSummary } from './types';
export interface StepUpdate {steps:number;reliable:boolean;source:string;lastSyncedAt:string}
export async function startSessionSteps(modality:CardioModality,onUpdate:(update:StepUpdate)=>void):Promise<{stop:()=>void;available:boolean;message:string}> {
  const scope=captureAccountScope();
  if (modality==='cycling') return {stop:()=>{},available:false,message:'Passos não são usados no ciclismo.'};
  if (!(await Pedometer.isAvailableAsync())) return {stop:()=>{},available:false,message:'Pedômetro indisponível neste aparelho.'};
  assertAccountScope(scope);
  const permission=await Pedometer.requestPermissionsAsync();
  assertAccountScope(scope);
  if (!permission.granted) return {stop:()=>{},available:false,message:'Permissão de atividade negada. O cardio continua disponível.'};
  let reliable=AppState.currentState==='active';
  let lastSteps=0;
  const watch=Pedometer.watchStepCount(result=>{
    try{assertAccountScope(scope);}catch{watch.remove();return;}
    lastSteps=Math.max(lastSteps,result.steps);
    onUpdate({steps:lastSteps,reliable,source:'Pedômetro do aparelho',lastSyncedAt:new Date().toISOString()});
  });
  const appState=AppState.addEventListener('change',state=>{
    try{assertAccountScope(scope);}catch{watch.remove();appState.remove();return;}
    if(state!=='active'){
      reliable=false;
      // Expo Pedometer does not guarantee background delivery. Mark partial counts,
      // never silently label them as the whole session.
      onUpdate({steps:lastSteps,reliable:false,source:'Pedômetro do aparelho (parcial)',lastSyncedAt:new Date().toISOString()});
    }
  });
  return {available:true,message:'Passos da sessão pelo pedômetro. Contagem pode ficar parcial com a tela bloqueada.',stop:()=>{watch.remove();appState.remove();}};
}
export async function getDailySteps():Promise<StepSummary> {
  const scope=captureAccountScope();
  if (Platform.OS!=='ios') return {steps:null,source:null,lastSyncedAt:null,message:'Total diário não disponível neste adaptador Android. Passos da sessão são opcionais.'};
  if (!(await Pedometer.isAvailableAsync())) return {steps:null,source:null,lastSyncedAt:null,message:'Pedômetro indisponível.'};
  const permission=await Pedometer.requestPermissionsAsync();
  if(!permission.granted)return {steps:null,source:null,lastSyncedAt:null,message:'Permissão de atividade negada.'};
  const end=new Date(),start=new Date(end);start.setHours(0,0,0,0);
  try {
    const result=await Pedometer.getStepCountAsync(start,end);
    assertAccountScope(scope);
    return {steps:result.steps,source:'Apple Core Motion (aparelho)',lastSyncedAt:end.toISOString(),message:'Total diário do aparelho. Não inclui agregação de relógios e não é atribuído à sessão.'};
  } catch {assertAccountScope(scope);return {steps:null,source:null,lastSyncedAt:null,message:'Não foi possível consultar os passos. Ausência de dados não significa zero.'};}
}
