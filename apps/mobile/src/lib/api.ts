/** API-shaped facade over SQLite. No HTTP requests or account server. */
import {captureAccountScope,assertAccountScope} from './account-scope';
import {refreshLocalProfile} from './auth';
import {localRequest} from './local-service';
import type {RequestOptions} from './transport';
export {ApiError} from './transport';
export async function api<T>(path:string,options:RequestOptions={}):Promise<T>{
 const scope=captureAccountScope(options.expectedUserId,options.expectedSessionEpoch);
 const result=await localRequest<T>(scope.userId,path,options);
 assertAccountScope(scope);
 if((path==='/me'||path==='me'||path==='/me/avatar'||path==='me/avatar')&&options.method&&options.method!=='GET')await refreshLocalProfile();
 return result;
}
