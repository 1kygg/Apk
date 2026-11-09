import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerSessionCleanup } from './auth';
import { ApiError } from './api';
import { captureAccountScope,assertAccountScope } from './account-scope';
import { getLocalPreference,setLocalPreference } from './storage';
import type { ReminderPreferences } from './types';
import { isQuietTime } from './reminder-model';
export { isQuietTime } from './reminder-model';
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:false,shouldSetBadge:false})});
async function cancelOwnerReminders(userId:string){
  const key='reminders.'+userId;
  const ids=await getLocalPreference<string[]>(key+'.ids')??[];
  await Promise.all(ids.map(id=>Notifications.cancelScheduledNotificationAsync(id)));
  await setLocalPreference(key+'.ids',[]);
}
export async function cancelReminders():Promise<void>{
  const scope=captureAccountScope();await cancelOwnerReminders(scope.userId);assertAccountScope(scope);
}
export async function scheduleReminders(preferences:ReminderPreferences):Promise<void>{
  const scope=captureAccountScope();
  if(!Number.isInteger(preferences.hour)||preferences.hour<0||preferences.hour>23||!Number.isInteger(preferences.minute)||preferences.minute<0||preferences.minute>59||preferences.days.some(d=>!Number.isInteger(d)||d<1||d>7))throw new ApiError('Dias ou horário de lembrete inválidos.','INVALID_REMINDER');
  if(preferences.enabled&&preferences.days.length===0)throw new ApiError('Escolha pelo menos um dia para lembrar.','INVALID_REMINDER');
  if(preferences.enabled&&isQuietTime(preferences.hour,preferences.minute,preferences.quietStart,preferences.quietEnd))throw new ApiError('O lembrete coincide com seu horário de silêncio. Escolha outro horário.','QUIET_HOURS');
  const key='reminders.'+scope.userId;
  if(!preferences.enabled){
    await cancelOwnerReminders(scope.userId);assertAccountScope(scope);
    await setLocalPreference(key+'.preferences',preferences);assertAccountScope(scope);return;
  }
  const created:string[]=[];
  try{
    if(Platform.OS==='android'){await Notifications.setNotificationChannelAsync('personal-reminders',{name:'Lembretes pessoais',importance:Notifications.AndroidImportance.DEFAULT,vibrationPattern:[]});assertAccountScope(scope);}
    const permission=await Notifications.requestPermissionsAsync({ios:{allowAlert:true,allowBadge:false,allowSound:true}});
    assertAccountScope(scope);
    if(!permission.granted)throw new ApiError('Notificações não autorizadas. Sua agenda continua disponível sem lembretes.','NOTIFICATIONS_DENIED');
    await cancelOwnerReminders(scope.userId);assertAccountScope(scope);
    for(const day of [...new Set(preferences.days)]){
      assertAccountScope(scope);
      const id=await Notifications.scheduleNotificationAsync({
        content:{title:'Seu momento de movimento',body:'Confira sua sugestão de hoje. Descansar também faz parte.',data:{screen:'Hoje',ownerId:scope.userId}},
        trigger:{type:Notifications.SchedulableTriggerInputTypes.WEEKLY,weekday:day===7?1:day+1,hour:preferences.hour,minute:preferences.minute,channelId:'personal-reminders'},
      });
      created.push(id);assertAccountScope(scope);
    }
    await setLocalPreference(key+'.ids',created);assertAccountScope(scope);
    await setLocalPreference(key+'.preferences',preferences);assertAccountScope(scope);
  }catch(error){
    // A permission dialog/scheduler may resolve after logout. Remove only IDs
    // created by this operation, never a different account's reminders.
    await Promise.allSettled(created.map(id=>Notifications.cancelScheduledNotificationAsync(id)));
    throw error;
  }
}
export async function getReminderPreferences(){
  const scope=captureAccountScope();const preferences=await getLocalPreference<ReminderPreferences>('reminders.'+scope.userId+'.preferences');assertAccountScope(scope);return preferences;
}
registerSessionCleanup(async(_action,userId)=>{if(userId)await cancelOwnerReminders(userId);},-10);
