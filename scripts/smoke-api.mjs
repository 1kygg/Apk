import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';

// Exercises the actual built entry point, separate from Fastify's inject factory.
const root=fileURLToPath(new URL('../',import.meta.url));
const database=process.env.TEST_DATABASE_URL??process.env.DATABASE_URL;
if(!database)throw new Error('Configure um PostgreSQL de teste para o smoke da API.');
const socket=createServer();
await new Promise((resolve,reject)=>socket.once('error',reject).listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
const child=spawn(process.execPath,['apps/api/dist/server.js'],{
  cwd:root,stdio:['ignore','ignore','inherit'],
  env:{...process.env,DATABASE_URL:database,HOST:'127.0.0.1',PORT:String(port),
    JWT_SECRET:'smoke-test-only-not-a-production-key-32-bytes',GOOGLE_CLIENT_IDS:'',APPLE_CLIENT_IDS:''},
});
let exited=false;
const exit=once(child,'exit').then(([code])=>{exited=true;return code;});
const base='http://127.0.0.1:'+port+'/v1';
const delay=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref();});
try{
  let ready=false;
  for(let i=0;i<60&&!exited;i++){
    try{const response=await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});const health=await response.json();assert.equal(response.status,200);assert.equal(health.database,'ok');ready=true;break;}catch{await delay(150);}
  }
  assert.ok(ready,'A API compilada não iniciou com banco e configuração válidos.');
  const config=await (await fetch(base+'/config')).json();
  assert.deepEqual(config.providers,{google:false,apple:false});
  assert.equal(config.nativeBuildRequired,true);
  assert.equal((await fetch(base+'/me')).status,401);
  assert.equal((await fetch(base+'/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'forged@example.invalid'})})).status,400);
}finally{
  if(!exited)child.kill('SIGTERM');
  await Promise.race([exit,delay(5000)]);
  if(!exited)child.kill('SIGKILL');
}
assert.equal(await exit,0,'A API não encerrou corretamente.');
console.info('Smoke aprovado: API compilada iniciou, respondeu via HTTP e encerrou com PostgreSQL real.');
