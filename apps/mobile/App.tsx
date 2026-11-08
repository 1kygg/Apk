import React,{useEffect,useRef,useState} from 'react';
import {AppState,BackHandler,Linking,Pressable,StatusBar,Text,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import Storage from 'expo-sqlite/kv-store';
import {api,ApiError} from './src/lib/api';
import {getSession,logout,registerSessionCleanup,restoreSession,signInApple,signInGoogle,subscribeSession} from './src/lib/auth';
import {configuration} from './src/lib/config';
import {parseInvite} from './src/lib/invites';
import {getTracker,initializeTracking,listLocalActivities,subscribeTracker,syncPendingActivities} from './src/lib/tracking';
import type {Session} from './src/lib/types';
import {Activities} from './src/ui/Activities';
import {Button,Loading,Notice,Screen,Section,ThemeProvider,Txt,useAction,useTheme} from './src/ui/components';
import {PreferencesForm} from './src/ui/Preferences';
import {Profile} from './src/ui/Profile';
import {Ranking} from './src/ui/Ranking';
import {Library,Today} from './src/ui/Training';
import {loadDrafts,removeDraft,syncTrainingDrafts} from './src/ui/trainingStore';
import {message,Preferences} from './src/ui/types';

type Tab='Hoje'|'Treinos'|'Atividades'|'Ranking'|'Perfil';
const tabs:Tab[]=['Hoje','Treinos','Atividades','Ranking','Perfil'];
export default function App(){return <SafeAreaProvider><ThemeProvider><Application/></ThemeProvider></SafeAreaProvider>;}
function Application(){
 const theme=useTheme(),c=theme.colors;
 const [session,setSession]=useState<Session|null>(getSession),[booting,setBooting]=useState(true),[sessionError,setSessionError]=useState<string|null>(null),[preferences,setPreferences]=useState<Preferences|null>(null),[checking,setChecking]=useState(false),[needsOnboarding,setNeedsOnboarding]=useState(false),[tab,setTab]=useState<Tab>('Hoje'),[offline,setOffline]=useState(false),[pending,setPending]=useState(0),[syncError,setSyncError]=useState<string|null>(null),[invite,setInvite]=useState<string|null>(null),[recording,setRecording]=useState(!!getTracker().activity&&['recording','paused','interrupted','review'].includes(getTracker().activity!.status)),[preferencesRevision,setPreferencesRevision]=useState(0);
 const tabRef=useRef<Tab>('Hoje'),lastPendingCheck=useRef(0),sessionRef=useRef<Session|null>(session),syncRef=useRef(false);
 useEffect(()=>{tabRef.current=tab;},[tab]);
 useEffect(()=>{sessionRef.current=session;},[session]);
 async function checkPreferences(current:Session){
  setChecking(true);setSessionError(null);setNeedsOnboarding(false);
  try{const p=await api<Preferences>('/me/preferences',{expectedUserId:current.user.id});if(getSession()?.user.id!==current.user.id)return;setPreferences(p);await Storage.setItem('consta.preferences.'+current.user.id,JSON.stringify(p));}
  catch(e){
    if(getSession()?.user.id!==current.user.id)return;
    if(e instanceof ApiError&&[404,428].includes(e.status)){setPreferences(null);setNeedsOnboarding(true);}
    else {const cached=await Storage.getItem('consta.preferences.'+current.user.id);if(getSession()?.user.id!==current.user.id)return;if(cached){try{setPreferences(JSON.parse(cached) as Preferences);}catch{setSessionError(message(e));}}else setSessionError(message(e));}
  }finally{if(getSession()?.user.id===current.user.id)setChecking(false);}
 }
 async function updatePending(force=false){if(!force&&Date.now()-lastPendingCheck.current<10000)return;lastPendingCheck.current=Date.now();const current=sessionRef.current;if(!current){setPending(0);return;}const [activities,drafts]=await Promise.all([listLocalActivities(),loadDrafts()]);if(getSession()?.user.id!==current.user.id)return;setPending(activities.filter(x=>x.syncStatus==='pending').length+drafts.filter(x=>x.userId===current.user.id&&x.pendingFinish).length);}
 async function synchronize(){
  const current=sessionRef.current;if(!current||syncRef.current)return;syncRef.current=true;setSyncError(null);
  try{await syncPendingActivities();await syncTrainingDrafts(current.user.id);}
  catch(e){if(getSession()?.user.id===current.user.id)setSyncError(message(e));}
  finally{syncRef.current=false;await updatePending(true);}
 }
 useEffect(()=>{
  const cleanup=registerSessionCleanup(async (action,userId)=>{const current=userId?{user:{id:userId}}:null;setSession(null);sessionRef.current=null;setPreferences(null);setChecking(false);setPending(0);if(action==='delete'&&current){await Storage.removeItem('consta.preferences.'+current.user.id);for(const env of ['default','home','gym','outdoor'])await Storage.removeItem('consta.plan.'+current.user.id+'.'+env);for(const draft of await loadDrafts())if(draft.userId===current.user.id)await removeDraft(draft.planId,current.user.id);}});
  const unsubscribe=subscribeSession(next=>{setSession(next);sessionRef.current=next;if(!next){setPreferences(null);setNeedsOnboarding(false);setChecking(false);setSessionError(null);setTab('Hoje');}});
  void restoreSession().catch(e=>setSessionError(message(e))).finally(()=>setBooting(false));
  const tracker=subscribeTracker(s=>{setRecording(!!s.activity&&['recording','paused','interrupted','review'].includes(s.activity.status));void updatePending();});
  const net=NetInfo.addEventListener(state=>{const connected=state.isConnected!==false&&state.isInternetReachable!==false;setOffline(!connected);if(connected)void synchronize();});
  const lifecycle=AppState.addEventListener('change',state=>{if(state==='active')void synchronize();});
  const back=BackHandler.addEventListener('hardwareBackPress',()=>{if(tabRef.current!=='Hoje'){setTab('Hoje');return true;}return false;});
  function receive(url:string){const code=parseInvite(url);if(code){setInvite(code);setTab('Ranking');}}
  void Linking.getInitialURL().then(url=>{if(url)receive(url);});const links=Linking.addEventListener('url',event=>receive(event.url));
  return()=>{cleanup();unsubscribe();tracker();net();lifecycle.remove();back.remove();links.remove();};
 },[]);
 useEffect(()=>{if(session){void checkPreferences(session);void initializeTracking().then(()=>synchronize()).catch(e=>{if(getSession()?.user.id===session.user.id)setSyncError(message(e));});}},[session?.user.id]);
 useEffect(()=>{if(!session)return;const id=setInterval(()=>{if(AppState.currentState==='active')void synchronize();},20000);return()=>clearInterval(id);},[session?.user.id]);
 function savedPreferences(p:Preferences){setPreferences(p);setNeedsOnboarding(false);if(session)void Storage.setItem('consta.preferences.'+session.user.id,JSON.stringify(p));setPreferencesRevision(v=>v+1);}
 return <SafeAreaView style={{flex:1,backgroundColor:c.background}} edges={['top','bottom']}>
  <StatusBar barStyle={theme.isLight?'dark-content':'light-content'} backgroundColor={c.background}/>
  {booting?<Screen title="Consta"><Loading/></Screen>:!session?<AuthScreen error={sessionError}/>:checking?<Screen title="Preparando seu espaço"><Loading/></Screen>:needsOnboarding?<PreferencesForm onboarding onSaved={savedPreferences}/>:sessionError&&!preferences?<Screen title="Não foi possível carregar sua conta"><Notice error>{sessionError}</Notice><Button title="Tentar novamente" onPress={()=>checkPreferences(session)}/><Button title="Sair da conta" variant="quiet" onPress={logout}/></Screen>:<>
   {offline&&<View accessibilityLiveRegion="polite" style={{paddingHorizontal:20,paddingVertical:9,backgroundColor:c.surface}}><Txt muted style={{fontSize:13}}>Sem internet. O que for registrado no aparelho terá sincronização pendente.</Txt></View>}
   {pending>0&&<Pressable accessibilityRole="button" onPress={()=>{setTab('Atividades');void synchronize();}} style={{minHeight:45,paddingHorizontal:20,paddingVertical:10}}><Text style={{color:c.accent,fontSize:14}}>{pending} registro(s) com sincronização pendente · toque para tentar</Text></Pressable>}
   {recording&&tab!=='Atividades'&&<Button title="Voltar à atividade em andamento" variant="quiet" onPress={()=>setTab('Atividades')}/>}
   {syncError&&pending>0&&<View style={{paddingHorizontal:20}}><Txt muted style={{fontSize:12}}>Sincronização pendente: {syncError}</Txt></View>}
   <View key={session.user.id} style={{flex:1}}>
    {tab==='Hoje'?<Today key={preferencesRevision} userId={session.user.id} timezone={preferences?.timezone} onPreferences={()=>setTab('Perfil')} onActivities={()=>setTab('Atividades')}/>:tab==='Treinos'?<Library/>:tab==='Atividades'?<Activities/>:tab==='Ranking'?<Ranking initialInvite={invite} onInviteHandled={()=>setInvite(null)}/>:<Profile onPreferencesChanged={()=>setPreferencesRevision(v=>v+1)}/>}
   </View>
   <View accessibilityRole="tablist" style={{flexDirection:'row',flexWrap:'wrap',borderTopWidth:1,borderTopColor:c.border,paddingTop:7,paddingBottom:3}}>
    {tabs.map(item=><Pressable key={item} accessibilityRole="tab" accessibilityLabel={item} accessibilityState={{selected:tab===item}} onPress={()=>setTab(item)} style={({pressed})=>({flexGrow:1,flexBasis:'20%',minHeight:59,paddingHorizontal:3,paddingVertical:14,justifyContent:'center',borderTopWidth:2,borderTopColor:tab===item?c.accent:'transparent',opacity:pressed ? .7 : 1})}><Text style={{fontSize:12,lineHeight:19,textAlign:'center',fontWeight:tab===item?'700':'400',color:tab===item?c.accent:c.muted}}>{item}</Text></Pressable>)}
   </View>
  </>}
 </SafeAreaView>;
}
function AuthScreen({error}:{error:string|null}){
 const action=useAction();
 return <Screen title="Consta" subtitle="Treinos no seu ritmo. Desafios com seus amigos.">
  <View style={{height:30}}/>
  <Txt style={{fontSize:36,lineHeight:46,fontWeight:'600'}}>Aparecer também é progresso.</Txt>
  <Txt muted>Organize sua atividade física, registre seu cardio e compartilhe constância em grupos privados.</Txt>
  <Section title="Sua conta"><Button title="Entrar com Google" onPress={()=>action.run(signInGoogle)} busy={action.busy} disabled={!configuration.apiConfigured||!configuration.googleConfigured}/>{configuration.appleAvailable&&<Button title="Entrar com Apple" variant="quiet" onPress={()=>action.run(signInApple)} busy={action.busy} disabled={!configuration.apiConfigured}/>}</Section>
  {(!configuration.apiConfigured||!configuration.googleConfigured)&&<Notice>Configuração externa pendente: {!configuration.apiConfigured?'endereço seguro do backend. ':''}{!configuration.googleConfigured?'IDs OAuth e assinaturas do Google. ':''}O login só será habilitado depois da configuração real. Não há conta de demonstração.</Notice>}
  {error&&<Notice error>{error}</Notice>}{action.error&&<Notice error>{action.error}</Notice>}
  <Txt muted>Você controla permissões e dados. Localização, passos e notificações são solicitados somente quando você ativa a função correspondente.</Txt>
 </Screen>;
}
