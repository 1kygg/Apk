import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getSession, registerSessionCleanup } from './auth';
import { ApiError } from './api';
import { getLocalPreference, setLocalPreference } from './storage';
import type { ReminderPreferences } from './types';
import { isQuietTime } from './reminder-model';
export { isQuietTime } from './reminder-model';
Notifications.setNotificationHandler({
  handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:false,shouldSetBadge:false}),
});
export async function cancelReminders():Promise<void> {
  const userId=getSession()?.user.id;if(!userId)return;
  const key='reminders.'+userId;
  const ids=await getLocalPreference<string[]>(key+'.ids')??[];
  await Promise.all(ids.map(id=>Notifications.cancelScheduledNotificationAsync(id)));
  await setLocalPreference(key+'.ids',[]);
}
export async function scheduleReminders(preferences:ReminderPreferences):Promise<void>{
  const userId=getSession()?.user.id;if(!userId)throw new ApiError('Entre para configurar sua agenda.','AUTH_REQUIRED',401);
  if(!Number.isInteger(preferences.hour)||preferences.hour<0||preferences.hour>23||!Number.isInteger(preferences.minute)||preferences.minute<0||preferences.minute>59||preferences.days.some(d=>!Number.isInteger(d)||d<1||d>7))throw new ApiError('Dias ou horário de lembrete inválidos.','INVALID_REMINDER');
  if(preferences.enabled&&preferences.days.length===0)throw new ApiError('Escolha pelo menos um dia para lembrar.','INVALID_REMINDER');
  if(preferences.enabled&&isQuietTime(preferences.hour,preferences.minute,preferences.quietStart,preferences.quietEnd))throw new ApiError('O lembrete coincide com seu horário de silêncio. Escolha outro horário.','QUIET_HOURS');
  if(!preferences.enabled){await cancelReminders();await setLocalPreference('reminders.'+userId+'.preferences',preferences);return;}
  if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('personal-reminders',{name:'Lembretes pessoais',importance:Notifications.AndroidImportance.DEFAULT,vibrationPattern:[]});
  const permission=await Notifications.requestPermissionsAsync({ios:{allowAlert:true,allowBadge:false,allowSound:true}});
  if(!permission.granted)throw new ApiError('Notificações não autorizadas. Sua agenda continua disponível sem lembretes.','NOTIFICATIONS_DENIED');
  await cancelReminders();
  const ids:string[]=[];
  try{
    for(const day of [...new Set(preferences.days)]){
      ids.push(await Notifications.scheduleNotificationAsync({
        content:{title:'Seu momento de movimento',body:'Confira sua sugestão de hoje. Descansar também faz parte.',data:{screen:'Hoje'}},
        trigger:{type:Notifications.SchedulableTriggerInputTypes.WEEKLY,weekday:day===7?1:day+1,hour:preferences.hour,minute:preferences.minute,channelId:'personal-reminders'},
      }));
    }
  }catch(error){await Promise.all(ids.map(id=>Notifications.cancelScheduledNotificationAsync(id)));throw error;}
  await setLocalPreference('reminders.'+userId+'.ids',ids);
  await setLocalPreference('reminders.'+userId+'.preferences',preferences);
}
export async function getReminderPreferences(){const id=getSession()?.user.id;return id?getLocalPreference<ReminderPreferences>('reminders.'+id+'.preferences'):null;}
registerSessionCleanup(async()=>{await cancelReminders();});
