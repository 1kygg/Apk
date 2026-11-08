import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({store:new Map<string,string>(),nextUser:'A',expiresIn:900,refreshInvalid:false,googleCancel:false}));
vi.mock('react-native',()=>({Platform:{OS:'android'}}));
vi.mock('expo-secure-store',()=>({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,
  getItemAsync:async(key:string)=>state.store.get(key)??null,
  setItemAsync:async(key:string,value:string)=>{state.store.set(key,value);},
  deleteItemAsync:async(key:string)=>{state.store.delete(key);},
}));
vi.mock('expo-apple-authentication',()=>({isAvailableAsync:async()=>false}));
vi.mock('@react-native-google-signin/google-signin',()=>({
  GoogleSignin:{configure:vi.fn(),hasPlayServices:async()=>true,signIn:async()=>state.googleCancel?{type:'cancelled'}:{type:'success',data:{idToken:'google-'+state.nextUser}},signOut:async()=>{},revokeAccess:async()=>{}},
  isErrorWithCode:()=>false,statusCodes:{SIGN_IN_CANCELLED:'cancelled',IN_PROGRESS:'progress',PLAY_SERVICES_NOT_AVAILABLE:'unavailable'},
}));
vi.mock('./config',()=>({configuration:{apiConfigured:true,apiUrl:'https://test.invalid',googleConfigured:true,googleWebClientId:'web',googleIosClientId:''}}));
beforeEach(()=>{
  vi.resetModules();state.store.clear();state.nextUser='A';state.expiresIn=900;state.refreshInvalid=false;state.googleCancel=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url.endsWith('/auth/refresh')&&state.refreshInvalid)return Response.json({code:'INVALID_SESSION',message:'Revogada'},{status:401});
    return Response.json({accessToken:'access-'+state.nextUser,refreshToken:'refresh-'+state.nextUser,expiresIn:state.expiresIn,user:{id:state.nextUser,displayName:'Conta '+state.nextUser}});
  }));
});
afterEach(()=>vi.unstubAllGlobals());
describe('native auth orchestration with provider/storage mocks, no device verification',()=>{
  it('runs cleanup on invalid refresh and prevents B adoption before A cleanup finishes',async()=>{
    const auth=await import('./auth');const scope=await import('./account-scope');
    state.expiresIn=-1;await auth.signInGoogle();const old=scope.captureAccountScope();
    let release!:()=>void;const cleanupGate=new Promise<void>(resolve=>{release=resolve;});
    const cleanup=vi.fn(async()=>{await cleanupGate;});auth.registerSessionCleanup(cleanup);
    state.refreshInvalid=true;
    await expect(auth.refreshSession()).rejects.toMatchObject({status:401});
    expect(auth.getSession()).toBeNull();expect(()=>scope.assertAccountScope(old)).toThrow();
    expect(cleanup).toHaveBeenCalledTimes(1);
    state.nextUser='B';state.expiresIn=900;state.refreshInvalid=false;
    const loginB=auth.signInGoogle();await Promise.resolve();expect(auth.getSession()).toBeNull();
    release();await loginB;expect(auth.getSession()?.user.id).toBe('B');
  });
  it('cleans up a different identity before exposing its session',async()=>{
    const auth=await import('./auth');await auth.signInGoogle();
    const observed:string[]=[];auth.registerSessionCleanup(async(_action,owner)=>{observed.push(owner);});
    state.nextUser='B';await auth.signInGoogle();expect(observed).toEqual(['A']);expect(auth.getSession()?.user.id).toBe('B');
  });
  it('treats provider cancellation as cancellation without making an authenticated account',async()=>{
    const auth=await import('./auth');state.googleCancel=true;
    await expect(auth.signInGoogle()).rejects.toMatchObject({code:'AUTH_CANCELLED'});expect(auth.getSession()).toBeNull();
  });
});
