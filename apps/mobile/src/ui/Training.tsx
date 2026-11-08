import React,{useEffect,useState} from 'react';
import {AppState,BackHandler,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {SvgXml} from 'react-native-svg';
import Storage from 'expo-sqlite/kv-store';
import {useAccountApi} from './accountApi';
import {timerFeedback} from '../lib/device';
import {Button,Choice,Empty,Field,Loading,Notice,Row,Screen,Section,Sheet,Txt,confirmAction,useAction,useResource} from './components';
import {DayPlan,Environment,Exercise,PlannedExercise,environmentLabels,formatTime,message} from './types';
import {loadDraft,loadDrafts,saveDraft,SessionDraft,syncTrainingDrafts} from './trainingStore';

type LibraryData={exercises:Exercise[];equipment:Record<string,string>};
function useLibrary(){
 const resource=useResource<LibraryData>('/exercises');const [cached,setCached]=useState<LibraryData|null>(null);
 useEffect(()=>{void Storage.getItem('consta.library.v1').then(value=>{if(value)try{setCached(JSON.parse(value));}catch{}});},[]);
 useEffect(()=>{if(resource.data){setCached(resource.data);void Storage.setItem('consta.library.v1',JSON.stringify(resource.data));}},[resource.data]);
 return {...resource,data:resource.data||cached,error:cached?null:resource.error,loading:resource.loading&&!cached};
}
export function ExerciseDetails({exercise,library,equipment={},onClose}:{exercise:Exercise;library:Exercise[];equipment?:Record<string,string>;onClose:()=>void}){
 const easier=library.find(x=>x.id===exercise.easierId);
 return <Sheet title={exercise.name} visible onClose={onClose}>
   {exercise.media?.kind==='svg'&&<View accessible accessibilityLabel={exercise.media.description}><SvgXml xml={exercise.media.svg} width="100%" height={180}/><Txt muted style={{fontSize:12}}>Ilustração original {exercise.media.author} · {exercise.media.license}</Txt></View>}
   <Txt>{exercise.muscles.join(' · ')}</Txt><Txt muted>{exercise.equipment.length?'Equipamentos: '+exercise.equipment.map(id=>equipment[id]||id).join(', '):'Sem equipamentos'}</Txt>
   <Section title="Execução">{exercise.instructions.map((line,i)=><Txt key={i}>{i+1}. {line}</Txt>)}</Section>
   <Txt>{exercise.sets||'—'} séries · {exercise.repetitions?exercise.repetitions+' repetições':(exercise.durationSeconds||0)+' segundos'}</Txt>
   <Txt muted>Descanso sugerido: {exercise.restSeconds||45} segundos. Reduza as séries e adapte a amplitude quando precisar.</Txt>
   {easier&&<Section title="Alternativa mais fácil"><Txt>{easier.name}</Txt>{easier.instructions.map((x,i)=><Txt muted key={i}>{x}</Txt>)}</Section>}
   {!!exercise.substitutionIds?.length&&<Section title="Substituições compatíveis">{exercise.substitutionIds.map(id=><Txt key={id}>{library.find(x=>x.id===id)?.name||id}</Txt>)}</Section>}
 </Sheet>;
}
export function Library(){
 const resource=useLibrary();
 const [search,setSearch]=useState(''),[environment,setEnvironment]=useState<Environment|null>(null),[selected,setSelected]=useState<Exercise|null>(null);
 return <Screen title="Treinos" subtitle="Uma biblioteca para conhecer e adaptar seus movimentos." onRefresh={resource.reload} refreshing={resource.loading}>
  <Field label="Buscar exercício" value={search} onChangeText={setSearch}/><Row><Choice title="Todos" selected={!environment} onPress={()=>setEnvironment(null)}/>{Object.entries(environmentLabels).map(([id,name])=><Choice key={id} title={name} selected={environment===id} onPress={()=>setEnvironment(id as Environment)}/>)}</Row>
  {resource.loading?<Loading/>:resource.error?<Notice error>{resource.error}</Notice>:!(resource.data?.exercises.length)?<Empty text="A biblioteca ainda não está disponível no servidor."/>:resource.data.exercises.filter(x=>(!environment||x.environments?.includes(environment))&&x.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(x=><Section key={x.id}><Txt style={{fontWeight:'600'}}>{x.name}</Txt><Txt muted>{x.muscles.join(' · ')} · {x.equipment.length?x.equipment.map(id=>resource.data?.equipment[id]||id).join(', '):'Peso do corpo'}</Txt><Button title="Ver execução e alternativas" variant="quiet" onPress={()=>setSelected(x)}/></Section>)}
  {selected&&<ExerciseDetails exercise={selected} library={resource.data?.exercises||[]} equipment={resource.data?.equipment} onClose={()=>setSelected(null)}/>}
 </Screen>;
}
export function Today({userId,timezone,onPreferences,onActivities}:{userId:string;timezone?:string;onPreferences:()=>void;onActivities:()=>void}){
 const api=useAccountApi();
 const [environment,setEnvironment]=useState<Environment|undefined>(),[session,setSession]=useState<DayPlan|null>(null),[detail,setDetail]=useState<Exercise|null>(null),[replacement,setReplacement]=useState<PlannedExercise|null>(null);
 const planResource=useResource<DayPlan>('/plans/today'+(environment?'?environment='+environment:''));
 const library=useResource<{exercises:Exercise[];equipment:Record<string,string>}>('/exercises');
 const [cachedPlan,setCachedPlan]=useState<DayPlan|null>(null),[recovered,setRecovered]=useState<SessionDraft[]>([]);
 const cacheKey='consta.plan.'+userId+'.'+(environment||'default');
 useEffect(()=>{setCachedPlan(null);void Storage.getItem(cacheKey).then(raw=>{if(!raw)return;try{const saved=JSON.parse(raw) as DayPlan;const parts=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:timezone}).formatToParts(new Date());const part=(type:string)=>parts.find(p=>p.type===type)?.value;const today=part('year')+'-'+part('month')+'-'+part('day');if(saved.date===today||saved.status==='started')setCachedPlan(saved);}catch{}});void loadDrafts().then(all=>setRecovered(all.filter(d=>d.userId===userId&&!d.pendingFinish&&!!d.snapshot)));},[cacheKey,userId,timezone]);
 useEffect(()=>{if(planResource.data&&(!environment||planResource.data.environment===environment)){setCachedPlan(planResource.data);void Storage.setItem(cacheKey,JSON.stringify(planResource.data));}},[planResource.data,cacheKey,environment]);
 const action=useAction(),plan=(planResource.data&&(!environment||planResource.data.environment===environment)?planResource.data:null)||(cachedPlan&&(!environment||cachedPlan.environment===environment)?cachedPlan:null);
 async function start(){if(!plan)return;await action.run(async()=>{const result=await api<{plan:DayPlan}>('/plans/'+plan.id+'/start',{method:'POST',body:{clientId:Crypto.randomUUID()}});setSession(result.plan);planResource.setData(result.plan);});}
 async function substitute(id:string){if(!plan||!replacement)return;await action.run(async()=>{const updated=await api<DayPlan>('/plans/'+plan.id+'/substitute',{method:'POST',body:{exerciseId:replacement.id,replacementId:id}});planResource.setData(updated);setReplacement(null);});}
 if(session)return <WorkoutSession initialPlan={session} userId={userId} library={library.data?.exercises||[]} onClose={()=>{setSession(null);void planResource.reload();}}/>;
 return <Screen title="Hoje" subtitle={plan?.date?new Date(plan.date+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}):'Um passo de cada vez, no seu ritmo.'} onRefresh={planResource.reload} refreshing={planResource.loading}>
  <Row>{Object.entries(environmentLabels).map(([id,name])=><Choice key={id} title={name} selected={plan?.environment===id} onPress={()=>{if(plan?.status==='started'){void action.run(async()=>{throw new Error('Este treino já começou. O ambiente e a versão da sessão estão preservados no histórico.');});return;}setEnvironment(id as Environment);}}/>)}</Row>
  {recovered.filter(d=>d.planId!==plan?.id).map(d=><Section key={d.planId} title="Sessão salva para retomar"><Txt muted>Iniciada em {new Date(d.startedAt).toLocaleString('pt-BR')}. O intervalo perdido não foi contabilizado.</Txt><Button title="Retomar progresso salvo" variant="quiet" onPress={()=>setSession(d.snapshot!)}/></Section>)}
  {planResource.error&&plan&&<Notice>Mostrando o treino salvo no aparelho. A conexão com o servidor está indisponível; progresso local terá sincronização pendente.</Notice>}
  {planResource.loading&&!plan?<Loading/>:planResource.error&&!plan?<><Notice error>{planResource.error}</Notice><Button title="Revisar preferências" variant="quiet" onPress={onPreferences}/></>:plan&&<>
   <Section><Txt style={{fontSize:23,lineHeight:31,fontWeight:'600'}}>{plan.kind==='rest'?'Hoje pode ser um dia de descanso':plan.focus}</Txt><Txt muted>{plan.reason}</Txt>{plan.durationMinutes&&plan.kind!=='rest'?<Txt>{plan.durationMinutes} minutos · {environmentLabels[plan.environment]}</Txt>:null}</Section>
   {plan.kind==='rest'?<><Txt>Recuperar também faz parte. Se quiser se movimentar, uma atividade leve continua disponível, sem cobrança.</Txt><Button title="Explorar atividades" variant="quiet" onPress={onActivities}/></>:<>
    <Section title="Antes de começar">{plan.warmup.map((x,i)=><Txt key={i}>{x}</Txt>)}<Txt muted>{plan.safetyNote||'Escolha uma execução confortável. Pare se sentir dor ou mal-estar.'}</Txt></Section>
    {plan.exercises.map((x,i)=><Section key={x.id}><Txt style={{fontWeight:'600'}}>{i+1}. {x.name}</Txt><Txt muted>{x.sets} séries · {x.repetitions?x.repetitions+' repetições':x.durationSeconds+' segundos'} · {x.muscles.join(', ')}</Txt><Row><Button title="Como fazer" variant="quiet" onPress={()=>setDetail(library.data?.exercises.find(y=>y.id===x.exerciseId)||x)}/>{plan.status==='draft'&&!!x.substitutionIds.length&&<Button title="Substituir" variant="quiet" onPress={()=>setReplacement(x)}/>}</Row></Section>)}
    <Notice>Conclusão autodeclarada. Adaptações e versões mais fáceis têm o mesmo valor na constância, conforme o regulamento do desafio.</Notice>
    {plan.status==='completed'?<Notice>Treino concluído. Seu histórico foi preservado.</Notice>:<Button title={plan.status==='started'?'Retomar sessão':'Iniciar treino'} busy={action.busy} onPress={plan.status==='started'?()=>setSession(plan):start}/>}
    <Button title="Prefiro cardio ou esporte" variant="quiet" onPress={onActivities}/>
   </>}
  </>}
  {action.error&&<Notice error>{action.error}</Notice>}
  {detail&&<ExerciseDetails exercise={detail} library={library.data?.exercises||[]} equipment={library.data?.equipment} onClose={()=>setDetail(null)}/>}
  {replacement&&<Sheet visible title={'Substituir '+replacement.name} onClose={()=>setReplacement(null)}><Txt muted>A alternativa deve ser compatível com seu ambiente e equipamentos.</Txt>{replacement.substitutionIds.map(id=>{const item=library.data?.exercises.find(x=>x.id===id);return <Button key={id} title={item?.name||id} variant="quiet" busy={action.busy} onPress={()=>substitute(id)}/>;})}{action.error&&<Notice error>{action.error}</Notice>}</Sheet>}
 </Screen>;
}
function WorkoutSession({initialPlan,userId,library,onClose}:{initialPlan:DayPlan;userId:string;library:Exercise[];onClose:()=>void}){
 const api=useAccountApi();
 const [plan,setPlan]=useState(initialPlan),[draft,setDraft]=useState<SessionDraft|null>(null),[rest,setRest]=useState(0),[restLength,setRestLength]=useState(45),[timerOn,setTimerOn]=useState(true),[vibration,setVibration]=useState(false),[detail,setDetail]=useState<Exercise|null>(null),[state,setState]=useState('Salvo no aparelho');
 const action=useAction();
 useEffect(()=>{void loadDraft(plan.id,userId).then(saved=>setDraft(saved||{planId:plan.id,userId,startedAt:new Date().toISOString(),activeSeconds:0,sets:plan.progress?.sets||{},adaptations:plan.progress?.adaptations||{},notes:plan.progress?.notes||'',pendingFinish:false,snapshot:plan}));},[plan.id,userId]);
 useEffect(()=>{if(!draft)return;const interval=setInterval(()=>{if(AppState.currentState!=='active'||!timerOn)return;setDraft(d=>d&&!d.pendingFinish?{...d,activeSeconds:d.activeSeconds+1}:d);setRest(r=>{if(r===1)void timerFeedback(vibration);return Math.max(0,r-1);});},1000);return ()=>clearInterval(interval);},[!!draft,timerOn,vibration]);
 useEffect(()=>{if(!draft)return;const timeout=setTimeout(()=>{void saveDraft(draft).catch(()=>setState('Falha ao salvar no aparelho. Mantenha a sessão aberta.'));},200);return()=>clearTimeout(timeout);},[draft]);
 function leave(){if(draft?.pendingFinish){onClose();return;}confirmAction('Sair da sessão?','Seu progresso ficará salvo no aparelho. A contagem de tempo para enquanto a tela não estiver ativa.',onClose);}
 useEffect(()=>{const event=BackHandler.addEventListener('hardwareBackPress',()=>{leave();return true;});return()=>event.remove();},[draft]);
 async function sync(){if(!draft)return;await saveDraft(draft);await action.run(async()=>{const updated=await api<DayPlan>('/plans/'+plan.id+'/progress',{method:'PATCH',body:{sets:draft.sets,adaptations:draft.adaptations,notes:draft.notes}});setPlan(updated);setState('Confirmado no servidor');});}
 async function finish(){if(!draft)return;confirmAction('Concluir treino?','Você declara que concluiu a sessão adaptada. Cronômetro e sensores não comprovam exercícios de força.',async()=>{
  const finished={...draft,pendingFinish:true,finishedAt:new Date().toISOString()};setDraft(finished);await saveDraft(finished);setState('Sincronização pendente');
  await action.run(async()=>{await syncTrainingDrafts(userId,draft.planId);setState('Confirmado no servidor');onClose();});
 });}
 function adapt(slot:string,update:Record<string,unknown>){setDraft(d=>d?{...d,adaptations:{...d.adaptations,[slot]:{...d.adaptations[slot],...update}}}:d);}
 if(!draft)return <Screen title="Preparando sessão"><Loading/></Screen>;
 return <Screen title={draft.pendingFinish?'Sessão salva no aparelho':'Seu treino'} subtitle={state} onBack={leave}>
  <Txt style={{fontSize:31,fontWeight:'600',lineHeight:38}}>{formatTime(draft.activeSeconds)}</Txt><Txt muted>Tempo de execução nesta tela. Interrupções e períodos com a tela inativa não são inventados.</Txt>
  <Row><Button title={timerOn?'Pausar cronômetro':'Retomar cronômetro'} variant="quiet" disabled={draft.pendingFinish} onPress={()=>setTimerOn(x=>!x)}/><Choice title="Vibração no descanso" selected={vibration} onPress={()=>setVibration(x=>!x)}/></Row>
  <Section title="Descanso"><Txt style={{fontSize:26,lineHeight:34}}>{formatTime(rest)}</Txt><Field label="Descanso em segundos" value={String(restLength||'')} keyboardType="number-pad" onChangeText={v=>setRestLength(Math.min(600,Math.max(0,Number(v))))}/><Row><Button title="Iniciar descanso" variant="quiet" onPress={()=>setRest(restLength)}/><Button title="Encerrar descanso" variant="quiet" onPress={()=>setRest(0)}/></Row></Section>
  {!draft.pendingFinish&&plan.exercises.map((original,i)=>{
    const adaptation=draft.adaptations[original.id]||{},exercise=library.find(x=>x.id===adaptation.exerciseId)||original,setsCount=adaptation.sets??original.sets,checked=draft.sets[original.id]||[];
    return <Section key={original.id} title={(i+1)+'. '+exercise.name}><Txt muted>{exercise.muscles.join(' · ')} · {adaptation.repetitions??original.repetitions?String(adaptation.repetitions??original.repetitions)+' repetições':String(adaptation.durationSeconds??original.durationSeconds)+' segundos'}</Txt><Button title="Instruções" variant="quiet" onPress={()=>setDetail(exercise)}/><Row>{Array.from({length:setsCount},(_,index)=><Choice key={index} title={'Série '+(index+1)} selected={!!checked[index]} onPress={()=>{const next=Array.from({length:setsCount},(_,n)=>n===index?!checked[n]:!!checked[n]);setDraft(d=>d?{...d,sets:{...d.sets,[original.id]:next}}:d);if(!checked[index])setRest(restLength);}}/>)}</Row>
    <Row><Button title="Reduzir uma série" variant="quiet" disabled={setsCount<=1} onPress={()=>adapt(original.id,{sets:Math.max(1,setsCount-1)})}/>{original.easierId&&<Button title={adaptation.exerciseId?'Voltar ao exercício sugerido':'Usar versão mais fácil'} variant="quiet" onPress={()=>adapt(original.id,{exerciseId:adaptation.exerciseId?undefined:original.easierId})}/>}</Row>
    <Field label="Adaptação ou observação" value={adaptation.note||''} onChangeText={v=>adapt(original.id,{note:v})} multiline/>
    </Section>;
  })}
  <Field label="Observações da sessão" multiline value={draft.notes} onChangeText={notes=>setDraft(d=>d?{...d,notes}:d)} editable={!draft.pendingFinish}/>
  {plan.cooldown?.length?<Section title="Ao terminar">{plan.cooldown.map((x,i)=><Txt key={i}>{x}</Txt>)}</Section>:null}
  <Notice>Reduzir séries e adaptar não diminui o valor de uma conclusão elegível de constância. As regras do grupo definem a elegibilidade.</Notice>
  {action.error&&<Notice error>{action.error} Seu progresso permanece no aparelho. A sincronização será tentada quando houver conexão.</Notice>}
  {draft.pendingFinish?<Button title="Tentar sincronizar" busy={action.busy} onPress={()=>action.run(async()=>{await syncTrainingDrafts(userId);onClose();})}/>:<><Button title="Salvar progresso no servidor" variant="quiet" onPress={sync} busy={action.busy}/><Button title="Concluir sessão adaptada" onPress={finish} busy={action.busy}/></>}
  {detail&&<ExerciseDetails exercise={detail} library={library} onClose={()=>setDetail(null)}/>}
 </Screen>;
}
