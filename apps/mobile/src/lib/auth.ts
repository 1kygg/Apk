/** Local profile lifecycle. This is not authentication or verified identity. */
import * as Crypto from 'expo-crypto';
import {getLocalPreference,setLocalPreference,database,deleteOwnerData,withLocalDatabaseWrite} from './storage';
import {ApiError} from './transport';
import {activateAccountScope,invalidateAccountScope,captureAccountScope,assertAccountScope} from './account-scope';
import type {Session,User} from './types';
export type LocalProfile=User&{createdAt:string};
const PROFILE_KEY='local-profile.v1';
let session:Session|null=null;
let operations:Promise<unknown>=Promise.resolve();
const subscribers=new Set<(value:Session|null)=>void>();
const cleanup=new Map<(action:'logout'|'delete',userId:string)=>Promise<void>,number>();
function serial<T>(action:()=>Promise<T>):Promise<T>{const pending=operations.then(action,action);operations=pending.catch(()=>{});return pending;}
function emit(){for(const listener of subscribers)listener(session);}
export function getSession(){return session;}
export function subscribeSession(listener:(value:Session|null)=>void){subscribers.add(listener);return()=>{subscribers.delete(listener);};}
export function registerSessionCleanup(callback:(action:'logout'|'delete',userId:string)=>Promise<void>,priority=0){cleanup.set(callback,priority);return()=>{cleanup.delete(callback);};}
function accept(profile:LocalProfile):Session{activateAccountScope(profile.id);session={user:profile,local:true};emit();return session;}
function profileInput(displayName:string,avatarUrl?:string|null){
 const name=displayName.trim();
 if(!name||name.length>80)throw new ApiError('Informe um nome entre 1 e 80 caracteres.','INVALID_PROFILE',400);
 if(avatarUrl&&!avatarUrl.startsWith('file://')&&!avatarUrl.startsWith('data:image/'))throw new ApiError('Escolha uma imagem do aparelho.','INVALID_AVATAR',400);
 return {displayName:name,avatarUrl:avatarUrl??null};
}
export function restoreSession():Promise<Session|null>{return serial(async()=>{
 const profile=await getLocalPreference<LocalProfile>(PROFILE_KEY);
 if(!profile?.id||!profile.displayName){invalidateAccountScope();session=null;emit();return null;}
 return accept(profile);
});}
export function createLocalProfile(input:{displayName:string;avatarUri?:string|null}):Promise<Session>{return serial(async()=>{
 const data=profileInput(input.displayName,input.avatarUri);
 if(await getLocalPreference(PROFILE_KEY))throw new ApiError('Já existe um perfil neste aparelho. Use a aba Perfil para editar.','PROFILE_EXISTS',409);
 const profile:LocalProfile={...data,id:Crypto.randomUUID(),createdAt:new Date().toISOString()};
 await setLocalPreference(PROFILE_KEY,profile);
 try{
  const {localRequest}=await import('./local-service');
  await localRequest(profile.id,'/me/preferences',{method:'PATCH',body:{goal:'health',level:'beginner',availableDays:[1,3,5],durationMinutes:25,environment:'home',equipment:[],modalities:['strength','walking'],avoidExerciseIds:[],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}});
 }catch(error){await withLocalDatabaseWrite(async db=>{await db.runAsync('DELETE FROM local_meta WHERE key=?',PROFILE_KEY);});throw error;}
 return accept(profile);
});}
export async function refreshLocalProfile():Promise<void>{
 const scope=captureAccountScope();
 const profile=await getLocalPreference<LocalProfile>(PROFILE_KEY);assertAccountScope(scope);
 if(!profile||profile.id!==scope.userId)throw new ApiError('O perfil local não está disponível.','PROFILE_MISSING',404);
 session={user:profile,local:true};emit();
}
export function deleteAccount():Promise<void>{return serial(async()=>{
 const scope=captureAccountScope();const userId=scope.userId;
 invalidateAccountScope();session=null;emit();
 const failed:unknown[]=[];
 // Cancel scheduled notifications before deleting their stored identifiers.
 for(const [callback] of [...cleanup].sort((a,b)=>a[1]-b[1]))try{await callback('delete',userId);}catch(error){failed.push(error);}
 const {deleteLocalServiceData}=await import('./local-service');
 await deleteLocalServiceData(userId);
 await deleteOwnerData(userId);
 await withLocalDatabaseWrite(async db=>{await db.runAsync('DELETE FROM local_meta WHERE key=?',PROFILE_KEY);});
 const files=await import('expo-file-system/legacy');
 if(files.documentDirectory)try{await files.deleteAsync(files.documentDirectory+'consta-avatars/',{idempotent:true});}catch(error){failed.push(error);}
 if(failed.length)throw new ApiError('Perfil removido. Não foi possível concluir toda a limpeza de arquivos ou lembretes; consulte os ajustes do aplicativo.','LOCAL_CLEANUP_FAILED');
});}
