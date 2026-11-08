import { getAccessToken,getSession,refreshSession } from './auth';
import { captureAccountScope,assertAccountScope } from './account-scope';
import { ApiError,request,type RequestOptions } from './transport';
export { ApiError } from './transport';
export async function api<T>(path:string,options:RequestOptions={}):Promise<T>{
  const scope=captureAccountScope(options.expectedUserId,options.expectedSessionEpoch);
  let token=await getAccessToken();
  assertAccountScope(scope);
  if(!token)throw new ApiError('Entre na sua conta para continuar.','AUTH_REQUIRED',401);
  try{return await request<T>(path,options,token,scope);}
  catch(error){
    assertAccountScope(scope);
    if(!(error instanceof ApiError)||error.status!==401)throw error;
    const latest=getSession()?.accessToken;
    token=latest&&latest!==token?latest:(await refreshSession())?.accessToken;
    assertAccountScope(scope);
    if(!token)throw new ApiError('Sua sessão expirou. Entre novamente.','SESSION_EXPIRED',401);
    return request<T>(path,options,token,scope);
  }
}
