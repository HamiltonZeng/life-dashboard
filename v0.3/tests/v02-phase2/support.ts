import {guardSynthetic} from '../v02-phase3/guard.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../../packages/db/src/client.js';
import {buildApp} from '../../apps/api/src/app.js';
import {seed,LOCAL_USER_ID,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from '../../packages/db/src/seed.js';
export {LOCAL_USER_ID,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS};
export function guard(){assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DATABASE_HOST,'postgres-test');assert.equal(process.env.DATABASE_NAME,'life_dashboard_v03_test');assert.equal(process.env.PHASE2_ACCEPTANCE,'codex');}
export async function fixture(initial='2026-10-20T12:00:00Z'){
 guard();let now=new Date(initial);const pool=createPool();(guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));await seed(pool);const app=await buildApp(pool,{profile:'mvp',origin:'http://codex.test',now:()=>new Date(now)});
 const login=await app.inject({method:'POST',url:'/api/v1/session',headers:{origin:'http://codex.test'},payload:{login_secret:process.env.LOCAL_LOGIN_SECRET}});assert.equal(login.statusCode,200,login.body);const cookie=String(login.headers['set-cookie']).split(';')[0];
 const req=(method:string,path:string,payload?:any,key:string=randomUUID(),headers:Record<string,string>={})=>app.inject({method:method as any,url:'/api/v1/'+path,payload,headers:{cookie,origin:'http://codex.test','idempotency-key':key,...headers}});
 const ok=async(method:string,path:string,payload?:any,key?:string)=>{const r=await req(method,path,payload,key);assert.equal(r.statusCode,200,`${method} ${path}: ${r.body}`);return r.json().data;};
 const record=async(date:string,minutes:number=10,options:any={})=>ok('POST','records',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],schema_version:1,occurred_at:date,timezone:'Asia/Shanghai',status:'confirmed',values:{topic:'phase-two synthetic fixture',duration_minutes:minutes},task_ids:[],...options});
 const template=async(overrides:any={})=>ok('POST','task-templates',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],title:'phase-two synthetic task',category:'daily',timezone:'Asia/Shanghai',completion_mode:'manual',rule:null,color:'blue',...overrides});
 return {pool,app,cookie,req,ok,record,template,now:()=>new Date(now),setNow:(value:string)=>{now=new Date(value);},close:async()=>{await app.close();await pool.end();}};
}
