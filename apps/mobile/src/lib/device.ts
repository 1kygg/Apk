import { AccessibilityInfo, Linking, Share } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { api } from './api';
import {inviteLink} from './invites';
import { captureAccountScope,assertAccountScope } from './account-scope';
export async function pickAvatar():Promise<string|null>{
  const scope=captureAccountScope();
  // System photo picker, no broad library, camera or microphone access requested.
  const result=await ImagePicker.launchImageLibraryAsync({
    mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:0.85,
    allowsMultipleSelection:false,
  });
  assertAccountScope(scope);
  if(result.canceled||!result.assets[0])return null;
  const image=await ImageManipulator.manipulateAsync(result.assets[0].uri,[{resize:{width:512,height:512}}],{compress:0.8,format:ImageManipulator.SaveFormat.JPEG,base64:true});
  assertAccountScope(scope);
  if(!image.base64)throw new Error('Não foi possível preparar o avatar.');
  const response=await api<{avatarUrl:string}>('me/avatar',{method:'POST',expectedUserId:scope.userId,expectedSessionEpoch:scope.epoch,body:{base64:image.base64,mimeType:'image/jpeg'}});
  assertAccountScope(scope);return response.avatarUrl;
}
export async function shareInvite(code:string):Promise<void>{
  const normalized=code.trim();const url=inviteLink(normalized);
  await Share.share({title:'Convite para o Consta',message:'Entre no meu grupo privado do Consta. Código: '+normalized+'\n'+url,url});
}
export function openPrivacySettings(){return Linking.openSettings();}
export async function timerFeedback(enabled:boolean){if(enabled)await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);}
export function isReduceMotionEnabled(){return AccessibilityInfo.isReduceMotionEnabled();}
export { privateRouteSegments } from './sharing-model';

export async function shareActivity(activityId:string,options:{includeRoute?:boolean;hideEndpointsMeters?:number}={}):Promise<void>{
  const scope=captureAccountScope();
  const [{getSession},{readActivities,readRoute},{privateRouteSegments,makeGpx}]=await Promise.all([
    import('./auth'),import('./storage'),import('./sharing-model'),
  ]);
  assertAccountScope(scope);
  const owner=scope.userId;
  if(!owner)throw new Error('Entre para compartilhar sua atividade.');
  const activity=(await readActivities(owner)).find(a=>!a.pendingDelete&&(a.clientId===activityId||a.serverId===activityId));
  assertAccountScope(scope);
  if(!activity)throw new Error('Esta atividade não está salva neste aparelho. Não há trajeto local para compartilhar.');
  const labels:Record<string,string>={walking:'Caminhada',running:'Corrida',cycling:'Ciclismo',strength:'Treino',football:'Futebol',basketball:'Basquete',volleyball:'Vôlei',other:'Atividade'};
  const title=labels[activity.modality]??'Atividade';
  const minutes=Math.round(activity.activeSeconds/60);
  const hasDistance=['walking','running','cycling'].includes(activity.modality);
  const summary=title+' no Consta: '+minutes+' min ativos'+(hasDistance?' · '+(activity.distanceMeters/1000).toLocaleString('pt-BR',{maximumFractionDigits:2})+' km':'')+'.'+(activity.source==='manual'?' Distância/duração informadas manualmente.':'');
  if(!options.includeRoute){
    await Share.share({title: title+' no Consta',message:summary});
    return;
  }
  const points=await readRoute(activity.clientId,owner);
  assertAccountScope(scope);
  const segments=privateRouteSegments(points,options.hideEndpointsMeters??200);
  if(!segments.length)throw new Error('O trajeto não tem pontos suficientes após ocultar o início e o fim.');
  const [FileSystem,Sharing]=await Promise.all([import('expo-file-system/legacy'),import('expo-sharing')]);
  assertAccountScope(scope);
  if(!(await Sharing.isAvailableAsync()))throw new Error('Compartilhamento de arquivos indisponível neste aparelho.');
  assertAccountScope(scope);
  if(!FileSystem.cacheDirectory)throw new Error('Armazenamento temporário indisponível.');
  const file=FileSystem.cacheDirectory+'consta-route-'+activity.clientId+'.gpx';
  await FileSystem.writeAsStringAsync(file,makeGpx(title,segments),{encoding:FileSystem.EncodingType.UTF8});
  try{
    assertAccountScope(scope);
    await Sharing.shareAsync(file,{dialogTitle:'Compartilhar trajeto com início/fim ocultos. Isso não garante anonimato.',mimeType:'application/gpx+xml',UTI:'com.topografix.gpx'});
  }finally{await FileSystem.deleteAsync(file,{idempotent:true});}
}
