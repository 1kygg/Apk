import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { configuration } from './config';
import { ApiError, request } from './transport';
import type { Session, User } from './types';
const REFRESH_KEY = 'consta.refresh.v1';
const USER_KEY = 'consta.user.v1';
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
type TokenResponse = { accessToken: string; refreshToken: string; expiresIn: number; user: User };
let session: Session | null = null;
let expiresAt = 0;
let refreshQueue: Promise<Session | null> | null = null;
let configured = false;
let authEpoch = 0;
let persistence = Promise.resolve();
function persistSerial<T>(action:()=>Promise<T>):Promise<T>{const result=persistence.then(action,action);persistence=result.then(()=>{},()=>{});return result;}
const subscribers = new Set<(value: Session | null) => void>();
const cleanup = new Set<(action: 'logout' | 'delete') => Promise<void>>();
export function registerSessionCleanup(callback: (action: 'logout' | 'delete') => Promise<void>) {
  cleanup.add(callback);
  return () => cleanup.delete(callback);
}
export function getSession() { return session; }
export function subscribeSession(listener: (value: Session | null) => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}
function emit() { for (const listener of subscribers) listener(session); }
async function accept(tokens: TokenResponse, epoch=authEpoch): Promise<Session> {
  if (!tokens.accessToken || !tokens.refreshToken || !tokens.user?.id) throw new ApiError('Resposta de sessão inválida.', 'INVALID_SESSION');
  return persistSerial(async()=>{
    if(epoch!==authEpoch)throw new ApiError('A sessão mudou durante esta operação.','AUTH_SESSION_CHANGED');
    await SecureStore.setItemAsync(REFRESH_KEY,tokens.refreshToken,secureOptions);
    await SecureStore.setItemAsync(USER_KEY,JSON.stringify(tokens.user),secureOptions);
    if(epoch!==authEpoch)throw new ApiError('A sessão mudou durante esta operação.','AUTH_SESSION_CHANGED');
    session={accessToken:tokens.accessToken,user:tokens.user};
    expiresAt=Date.now()+tokens.expiresIn*1000;emit();return session;
  });
}
async function clearSession() {
  await persistSerial(async()=>{
    session=null;expiresAt=0;
    await SecureStore.deleteItemAsync(REFRESH_KEY,secureOptions);
    await SecureStore.deleteItemAsync(USER_KEY,secureOptions);
    emit();
  });
}
export async function refreshSession(): Promise<Session | null> {
  if (refreshQueue) return refreshQueue;
  refreshQueue = (async () => {
    const epoch=authEpoch;
    const token = await SecureStore.getItemAsync(REFRESH_KEY, secureOptions);
    if (!token) { session = null; emit(); return null; }
    try {
      return await accept(await request<TokenResponse>('auth/refresh', { method: 'POST', body: { refreshToken: token } }),epoch);
    } catch (error) {
      if (epoch===authEpoch && error instanceof ApiError && (error.status === 401 || error.status === 403)) await clearSession();
      throw error;
    }
  })();
  try { return await refreshQueue; } finally { refreshQueue = null; }
}
export async function getAccessToken(): Promise<string | undefined> {
  if (session && Date.now() < expiresAt - 30000) return session.accessToken;
  return (await refreshSession())?.accessToken;
}
export async function restoreSession(): Promise<Session | null> {
  const epoch=authEpoch;
  try{return await refreshSession();}
  catch(error){
    if(error instanceof ApiError&&error.code==='NETWORK_ERROR'&&epoch===authEpoch){
      const cached=await SecureStore.getItemAsync(USER_KEY,secureOptions);
      const refresh=await SecureStore.getItemAsync(REFRESH_KEY,secureOptions);
      if(cached&&refresh){
        try{
          const user=JSON.parse(cached) as User;
          if(user.id){session={accessToken:'',user,offline:true};expiresAt=0;emit();return session;}
        }catch{/* Invalid cached profile is never treated as an identity credential. */}
      }
    }
    throw error;
  }
}
export async function signInGoogle(): Promise<Session> {
  if (!configuration.googleConfigured) throw new ApiError('Configure os IDs OAuth do Google e as assinaturas Android antes de entrar.', 'GOOGLE_CONFIGURATION_REQUIRED');
  if (!configured) {
    GoogleSignin.configure({
      webClientId: configuration.googleWebClientId,
      iosClientId: configuration.googleIosClientId || undefined,
      offlineAccess: false,
    });
    configured = true;
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();
    if (result.type === 'cancelled') throw new ApiError('Entrada cancelada.', 'AUTH_CANCELLED');
    if (!result.data.idToken) throw new ApiError('O Google não retornou uma credencial válida.', 'INVALID_CREDENTIAL');
    const epoch=++authEpoch;
    return await accept(await request<TokenResponse>('auth/google', { method: 'POST', body: { idToken: result.data.idToken } }),epoch);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) throw new ApiError('Entrada cancelada.', 'AUTH_CANCELLED');
      if (error.code === statusCodes.IN_PROGRESS) throw new ApiError('Uma entrada já está em andamento.', 'AUTH_IN_PROGRESS');
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new ApiError('Os serviços Google Play precisam estar disponíveis e atualizados.', 'PLAY_SERVICES_UNAVAILABLE');
    }
    throw new ApiError('Não foi possível entrar com Google. Verifique os IDs OAuth, a assinatura do aplicativo e a conexão.', 'GOOGLE_SIGN_IN_FAILED');
  }
}
export async function signInApple(): Promise<Session> {
  if (Platform.OS !== 'ios' || !(await AppleAuthentication.isAvailableAsync())) throw new ApiError('Entrar com Apple não está disponível neste aparelho.', 'APPLE_UNAVAILABLE');
  const challenge = await request<{ nonce: string; nonceId: string; nonceHash: string }>('auth/apple/nonce', { method: 'POST' });
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
      nonce: challenge.nonceHash,
      state: challenge.nonceId,
    });
    if (!credential.identityToken || credential.state !== challenge.nonceId) throw new ApiError('Resposta de identidade inválida.', 'INVALID_CREDENTIAL');
    const displayName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    const epoch=++authEpoch;
    return await accept(await request<TokenResponse>('auth/apple', {
      method: 'POST', body: { identityToken: credential.identityToken, nonceId: challenge.nonceId, displayName: displayName || undefined },
    }),epoch);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new ApiError('Entrada cancelada.', 'AUTH_CANCELLED');
    throw new ApiError('Não foi possível entrar com Apple.', 'APPLE_SIGN_IN_FAILED');
  }
}
export async function logout(): Promise<void> {
  ++authEpoch;
  const token = await SecureStore.getItemAsync(REFRESH_KEY, secureOptions);
  await Promise.allSettled([...cleanup].map(action=>action('logout')));
  try { if (token) await request('auth/logout', { method: 'POST', body: { refreshToken: token } }, session?.accessToken); }
  finally {
    await clearSession();
    try { if (configured) await GoogleSignin.signOut(); } catch { /* Local tokens already removed. */ }
  }
}
export async function deleteAccount(): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new ApiError('Entre na sua conta para excluí-la.', 'AUTH_REQUIRED', 401);
  try { await request('me', { method: 'DELETE', body: { confirm: true } }, token); }
  catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; else throw new ApiError('Entre novamente para confirmar a exclusão.', 'REAUTH_REQUIRED', 401); }
  ++authEpoch;
  const localCleanup=await Promise.allSettled([...cleanup].map(action=>action('delete')));
  await clearSession();
  try { if (configured) await GoogleSignin.revokeAccess(); } catch { /* Server account has been removed. */ }
  if(localCleanup.some(result=>result.status==='rejected'))throw new ApiError('Sua conta foi excluída no servidor, mas não foi possível concluir a limpeza local. Remova os dados do aplicativo nos ajustes do aparelho.','LOCAL_DELETE_FAILED');
}
