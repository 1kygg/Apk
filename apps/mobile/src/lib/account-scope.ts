/**
 * Account fences are local authorization boundaries, never proof of identity.
 * Server authorization still verifies the bearer token on every request.
 */
export interface AccountScope { readonly userId:string;readonly epoch:number }
export class AccountScopeError extends Error {
  readonly code='ACCOUNT_CHANGED';
  readonly status=409;
  constructor(){super('A conta mudou durante esta operação. Os registros pendentes permanecem vinculados à conta original.');this.name='AccountScopeError';}
}
export class AccountFence {
  private epoch=0;
  private active:AccountScope|null=null;
  private requests=new Map<symbol,{scope:AccountScope;abort:()=>void}>();
  peek():AccountScope|null{return this.active?{...this.active}:null;}
  activate(userId:string):AccountScope{
    if(!userId)throw new AccountScopeError();
    if(this.active?.userId===userId)return {...this.active};
    this.invalidate();
    this.active={userId,epoch:this.epoch};
    return {...this.active};
  }
  invalidate(){
    this.epoch++;this.active=null;
    const pending=[...this.requests.values()];this.requests.clear();
    for(const request of pending)request.abort();
  }
  capture(expectedUserId?:string,expectedEpoch?:number):AccountScope{
    const scope=this.active;
    if(!scope||(expectedUserId!==undefined&&expectedUserId!==scope.userId)||(expectedEpoch!==undefined&&expectedEpoch!==scope.epoch))throw new AccountScopeError();
    return {...scope};
  }
  assert(scope:AccountScope):void{
    if(!this.active||this.active.userId!==scope.userId||this.active.epoch!==scope.epoch)throw new AccountScopeError();
  }
  register(scope:AccountScope,abort:()=>void):()=>void{
    this.assert(scope);
    const id=Symbol('account-request');this.requests.set(id,{scope,abort});
    return ()=>{this.requests.delete(id);};
  }
}
const fence=new AccountFence();
export const getAccountScope=()=>fence.peek();
export const activateAccountScope=(userId:string)=>fence.activate(userId);
export const invalidateAccountScope=()=>fence.invalidate();
export const captureAccountScope=(userId?:string,epoch?:number)=>fence.capture(userId,epoch);
export const assertAccountScope=(scope:AccountScope)=>fence.assert(scope);
export const registerAccountRequest=(scope:AccountScope,abort:()=>void)=>fence.register(scope,abort);
