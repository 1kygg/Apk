import {beforeEach,describe,it,expect,vi} from 'vitest';

// Real SQLite SQL/transactions through an adapter. This is not a device/Expo test.
vi.mock('expo-sqlite',async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const sqlite=new DatabaseSync(':memory:');
  const adapter={
    execAsync:async(sql:string)=>{sqlite.exec(sql);},
    runAsync:async(sql:string,...params:any[])=>sqlite.prepare(sql).run(...params),
    getFirstAsync:async(sql:string,...params:any[])=>sqlite.prepare(sql).get(...params)??null,
    getAllAsync:async(sql:string,...params:any[])=>sqlite.prepare(sql).all(...params),
    withTransactionAsync:async(action:()=>Promise<void>)=>{
      sqlite.exec('BEGIN');try{await action();sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}
    },
  };
  return {openDatabaseAsync:async()=>adapter};
});
import {database,putActivity,enqueue,queued,acknowledge,readActivities,appendPoint,readRoute,setActiveId,getActiveId,deleteOwnerData,type StoredActivity} from './storage';
const activity=(owner:string,id:string)=>({ownerId:owner,clientId:id,notes:'Observação privada',syncStatus:'pending'} as StoredActivity);
beforeEach(async()=>{await (await database()).execAsync('DELETE FROM local_activities;DELETE FROM local_meta;');});
describe('private local data using the actual SQLite engine, no native hardware',()=>{
  it('keeps each account recoverable when another account starts its own session',async()=>{
    await putActivity(activity('A','session-A'));await setActiveId('session-A','A');
    await putActivity(activity('B','session-B'));await setActiveId('session-B','B');
    expect(await getActiveId('A')).toBe('session-A');expect(await getActiveId('B')).toBe('session-B');
    await setActiveId(null,'B');expect(await getActiveId('A')).toBe('session-A');
  });
  it('restricts route reads and removes only the excluded account including its queue',async()=>{
    const a=activity('A','session-A'),b=activity('B','session-B');
    await enqueue(a);await enqueue(b);await setActiveId(a.clientId,'A');await setActiveId(b.clientId,'B');
    const point={latitude:1,longitude:2,accuracy:5,timestamp:1000,segment:0};
    await appendPoint(a.clientId,point);await appendPoint(b.clientId,point);
    expect(await readRoute(a.clientId,'B')).toEqual([]);
    await deleteOwnerData('A');
    expect(await readActivities('A')).toEqual([]);expect(await getActiveId('A')).toBeNull();
    expect(await queued('A')).toEqual([]);expect(await readRoute(a.clientId,'A')).toEqual([]);
    expect(await readActivities('B')).toHaveLength(1);expect(await getActiveId('B')).toBe(b.clientId);
    expect(await queued('B')).toEqual([b.clientId]);expect(await readRoute(b.clientId,'B')).toHaveLength(1);
  });
  it('rolls back an acknowledgement if the identity is invalidated during the transaction',async()=>{
    const a=activity('A','session-A');await enqueue(a);let checks=0;
    await expect(acknowledge({...a,syncStatus:'server_confirmed'},()=>{if(++checks===2)throw new Error('account changed');})).rejects.toThrow('account changed');
    expect(await queued('A')).toEqual([a.clientId]);expect((await readActivities('A'))[0].syncStatus).toBe('pending');
  });
});
