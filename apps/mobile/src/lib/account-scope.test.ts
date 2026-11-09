import {describe,it,expect,vi} from 'vitest';
import {AccountFence,AccountScopeError} from './account-scope';
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
describe('account-scoped asynchronous work (pure tests)',()=>{
  it('invalidates A work after switching to B and again when returning to A',()=>{
    const fence=new AccountFence();const a=fence.activate('A');
    fence.activate('B');expect(()=>fence.assert(a)).toThrow(AccountScopeError);
    const newA=fence.activate('A');expect(newA.epoch).not.toBe(a.epoch);expect(()=>fence.assert(a)).toThrow();
  });
  it('aborts all registered account requests at logout',()=>{
    const fence=new AccountFence();const scope=fence.activate('A'),abort=vi.fn();
    fence.register(scope,abort);fence.invalidate();expect(abort).toHaveBeenCalledTimes(1);
    expect(()=>fence.capture('A')).toThrow(AccountScopeError);
  });
  it('preserves an A outbox entry when logout occurs before an awaited import/ACK',async()=>{
    const fence=new AccountFence();const scope=fence.activate('A'),gate=deferred<void>();
    const outbox=new Set(['A:activity']);const requests:string[]=[];
    const work=(async()=>{await gate.promise;fence.assert(scope);requests.push(scope.userId);outbox.delete('A:activity');})();
    fence.invalidate();fence.activate('B');gate.resolve();
    await expect(work).rejects.toThrow(AccountScopeError);
    expect(requests).toEqual([]);expect(outbox.has('A:activity')).toBe(true);
  });
  it('rejects an old completion response before local acknowledgement',async()=>{
    const fence=new AccountFence();const scope=fence.activate('A'),response=deferred<{id:string}>();
    const ack=vi.fn();const work=(async()=>{await response.promise;fence.assert(scope);ack();})();
    fence.activate('B');response.resolve({id:'server-A'});
    await expect(work).rejects.toThrow();expect(ack).not.toHaveBeenCalled();
  });
  it('keeps token rotation within the same account without canceling its scope',()=>{
    const fence=new AccountFence();const original=fence.activate('A');expect(fence.activate('A')).toEqual(original);fence.assert(original);
    expect(()=>fence.capture('B',original.epoch)).toThrow();
  });
});
