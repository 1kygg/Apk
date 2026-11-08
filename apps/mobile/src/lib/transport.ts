import { configuration } from './config';
import { assertAccountScope,captureAccountScope,registerAccountRequest,type AccountScope } from './account-scope';
export class ApiError extends Error {
  constructor(message:string,public code:string,public status=0){super(message);this.name='ApiError';}
}
export interface RequestOptions { method?:string;body?:unknown;expectedUserId?:string;expectedSessionEpoch?:number }
export async function request<T>(path:string,options:RequestOptions={},accessToken?:string,account?:AccountScope):Promise<T>{
  const scope=account??(options.expectedUserId?captureAccountScope(options.expectedUserId,options.expectedSessionEpoch):undefined);
  if(scope)assertAccountScope(scope);
  if(!configuration.apiConfigured)throw new ApiError('Configure o endereço HTTPS do servidor para conectar sua conta.','CONFIGURATION_REQUIRED');
  const controller=new AbortController();
  const unregister=scope?registerAccountRequest(scope,()=>controller.abort()):()=>{};
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(configuration.apiUrl+(path.startsWith('/v1/')?path:'/v1/'+path.replace(/^\//,'')),{
      method:options.method??'GET',
      headers:{Accept:'application/json',...(options.body===undefined?{}:{'Content-Type':'application/json'}),...(accessToken?{Authorization:'Bearer '+accessToken}:{})},
      body:options.body===undefined?undefined:JSON.stringify(options.body),
      signal:controller.signal,
    });
    if(scope)assertAccountScope(scope);
    if(response.status===204)return undefined as T;
    let body:unknown;try{body=await response.json();}catch{body=null;}
    if(scope)assertAccountScope(scope);
    if(!response.ok){
      const error=body as {code?:string;message?:string;error?:{code?:string;message?:string}}|null;
      throw new ApiError(error?.message??error?.error?.message??'O servidor não conseguiu concluir a operação.',error?.code??error?.error?.code??'REQUEST_FAILED',response.status);
    }
    return body as T;
  }catch(error){
    if(scope)assertAccountScope(scope);
    if(error instanceof ApiError)throw error;
    throw new ApiError('Sem conexão com o servidor. Seus registros locais permanecem no aparelho.','NETWORK_ERROR');
  }finally{clearTimeout(timeout);unregister();}
}
