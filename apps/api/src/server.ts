import {Pool} from 'pg';
import {buildApp} from './app.js';
if(!process.env.DATABASE_URL)throw new Error('Configure DATABASE_URL antes de iniciar a API.');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:20,idleTimeoutMillis:30000,connectionTimeoutMillis:10000});
const app=await buildApp({pool});
app.addHook('onClose',async()=>{await pool.end();});
const port=Number(process.env.PORT??3000);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT inválida.');
await app.listen({port,host:process.env.HOST??'0.0.0.0'});
console.info('Consta API disponível na porta '+port+'.');
let shuttingDown=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{
  if(shuttingDown)return;
  shuttingDown=true;
  await app.close();
});
