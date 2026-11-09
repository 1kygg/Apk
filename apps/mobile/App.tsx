import React,{useEffect,useRef,useState} from 'react';
import {AppState,BackHandler,Pressable,StatusBar,Text,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import Storage from 'expo-sqlite/kv-store';
import {api,ApiError} from './src/lib/api';
import {getSession,registerSessionCleanup,restoreSession,subscribeSession} from './src/lib/auth';
import {getTracker,initializeTracking,subscribeTracker,syncPendingActivities} from './src/lib/tracking';
import type {Session} from './src/lib/types';
import {Activities} from './src/ui/Activities';
import {Button,Loading,Notice,Screen,ThemeProvider,Txt,useTheme} from './src/ui/components';
import {LocalWelcome} from './src/ui/LocalWelcome';
import {PreferencesForm} from './src/ui/Preferences';
import {Profile} from './src/ui/Profile';
import {Ranking} from './src/ui/Ranking';
import {Library,Today} from './src/ui/Training';
import {removeProfileDrafts,syncTrainingDrafts} from './src/ui/trainingStore';
import {message,Preferences} from './src/ui/types';

type Tab='Hoje'|'Treinos'|'Atividades'|'Ranking'|'Perfil';
const tabs:Tab[]=['Hoje','Treinos','Atividades','Ranking','Perfil'];
export default function App(){return <SafeAreaProvider><ThemeProvider><Application/></ThemeProvider></SafeAreaProvider>;}
function Application(){
 const {colors:c,isLight}=useTheme();
 const [session,setSession]=useState<Session|null>(getSession),[booting,setBooting]=useState(true),[error,setError]=useState<string|null>(null),[preferences,setPreferences]=useState<Preferences|null>(null),[checking,setChecking]=useState(false),[needsPreferences,setNeedsPreferences]=useState(false),[tab,setTab]=useState<Tab>('Hoje'),[revision,setRevision]=useState(0),[recording,setRecording]=useState(false);
 const currentRef=useRef(session),tabRef=useRef<Tab>('Hoje'),saving=useRef(false);
 useEffect(()=>{tabRef.current=tab;},[tab]);
 async function readPreferences(current:Session){
  setChecking(true);setError(null);
  try{const p=await api<Preferences>('/me/preferences',{expectedUserId:current.user.id});if(getSession()?.user.id===current.user.id){setPreferences(p);setNeedsPreferences(false);}}
  catch(e){if(getSession()?.user.id!==current.user.id)return;if(e instanceof ApiError&&[404,428].includes(e.status)){setPreferences(null);setNeedsPreferences(true);}else setError(message(e));}
  finally{if(getSession()?.user.id===current.user.id)setChecking(false);}
 }
 async function finishLocalWrites(){
  const current=currentRef.current;if(!current||saving.current)return;saving.current=true;
  try{await syncPendingActivities();await syncTrainingDrafts(current.user.id);if(getSession()?.user.id===current.user.id)setError(null);}
  catch(e){if(getSession()?.user.id===current.user.id)setError(message(e));}
  finally{saving.current=false;}
 }
 useEffect(()=>{
  const unsubscribe=subscribeSession(next=>{currentRef.current=next;setSession(next);if(!next){setPreferences(null);setNeedsPreferences(false);setChecking(false);setTab('Hoje');}});
  const cleanup=registerSessionCleanup(async(action,userId)=>{
   if(action!=='delete')return;
   await Storage.removeItem('consta.preferences.'+userId);
   for(const env of ['default','home','gym','outdoor'])await Storage.removeItem('consta.plan.'+userId+'.'+env);
   await removeProfileDrafts(userId);
  });
  const tracker=subscribeTracker(state=>setRecording(!!state.activity&&['recording','paused','interrupted','review'].includes(state.activity.status)));
  const lifecycle=AppState.addEventListener('change',state=>{if(state==='active')void finishLocalWrites();});
  const back=BackHandler.addEventListener('hardwareBackPress',()=>{if(tabRef.current!=='Hoje'){setTab('Hoje');return true;}return false;});
  void restoreSession().catch(e=>setError(message(e))).finally(()=>setBooting(false));
  return()=>{unsubscribe();cleanup();tracker();lifecycle.remove();back.remove();};
 },[]);
 useEffect(()=>{if(session){void readPreferences(session);void initializeTracking().then(finishLocalWrites).catch(e=>{if(getSession()?.user.id===session.user.id)setError(message(e));});}},[session?.user.id]);
 function preferencesSaved(p:Preferences){setPreferences(p);setNeedsPreferences(false);setRevision(v=>v+1);}
 return <SafeAreaView style={{flex:1,backgroundColor:c.background}} edges={['top','bottom']}>
  <StatusBar barStyle={isLight?'dark-content':'light-content'} backgroundColor={c.background}/>
  {booting?<Screen title="Consta"><Loading/></Screen>:!session?<><LocalWelcome/>{error&&<View style={{padding:18}}><Notice error>{error}</Notice></View>}</>:checking?<Screen title="Preparando seu espaço"><Loading/></Screen>:needsPreferences?<PreferencesForm onboarding onSaved={preferencesSaved}/>:error&&!preferences?<Screen title="Não foi possível abrir os dados locais"><Notice error>{error}</Notice><Button title="Tentar novamente" onPress={()=>readPreferences(session)}/></Screen>:<>
   {error&&<View style={{padding:12}}><Notice error>{error}</Notice><Button title="Tentar salvar os registros locais" variant="quiet" onPress={finishLocalWrites}/></View>}
   {recording&&tab!=='Atividades'&&<Button title="Voltar à atividade em andamento" variant="quiet" onPress={()=>setTab('Atividades')}/>}
   <View key={session.user.id} style={{flex:1}}>
    {tab==='Hoje'?<Today key={revision} userId={session.user.id} timezone={preferences?.timezone} onPreferences={()=>setTab('Perfil')} onActivities={()=>setTab('Atividades')}/>:tab==='Treinos'?<Library/>:tab==='Atividades'?<Activities/>:tab==='Ranking'?<Ranking/>:<Profile onPreferencesChanged={()=>{setRevision(v=>v+1);void readPreferences(session);}}/>}
   </View>
   <View accessibilityRole="tablist" style={{flexDirection:'row',flexWrap:'wrap',borderTopWidth:1,borderTopColor:c.border,paddingTop:7,paddingBottom:3}}>
    {tabs.map(item=><Pressable key={item} accessibilityRole="tab" accessibilityLabel={item} accessibilityState={{selected:tab===item}} onPress={()=>setTab(item)} style={({pressed})=>({flexGrow:1,flexBasis:'20%',minHeight:59,paddingHorizontal:3,paddingVertical:14,justifyContent:'center',borderTopWidth:2,borderTopColor:tab===item?c.accent:'transparent',opacity:pressed ? 0.7 : 1})}><Text style={{fontSize:12,lineHeight:19,textAlign:'center',fontWeight:tab===item?'700':'400',color:tab===item?c.accent:c.muted}}>{item}</Text></Pressable>)}
   </View>
  </>}
 </SafeAreaView>;
}
