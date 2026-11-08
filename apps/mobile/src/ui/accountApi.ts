import {useState} from 'react';
import {api as requestApi} from '../lib/api';
import {captureAccountScope} from '../lib/account-scope';
type RequestOptions=NonNullable<Parameters<typeof requestApi>[1]>;
/** A mounted screen cannot acquire another account's credentials after an await or alert. */
export function useAccountApi(){
 const [scope]=useState(()=>captureAccountScope());
 return function api<T>(path:string,options:RequestOptions={}):Promise<T>{
  return requestApi<T>(path,{...options,expectedUserId:scope.userId,expectedSessionEpoch:scope.epoch});
 };
}
