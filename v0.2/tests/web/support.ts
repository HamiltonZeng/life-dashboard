import {guardSynthetic} from '../v02-phase3/guard.js';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createPool} from '../../packages/db/src/client.js';
import {seed,LOCAL_USER_ID,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from '../../packages/db/src/seed.js';
import {buildApp} from '../../apps/api/src/app.js';
export {LOCAL_USER_ID,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS};
export const artifacts='.runtime/test-artifacts/v02-phase3/web/legacy';
export function guard() {
  assert.equal(process.env.NODE_ENV,'test','Refuse non-test execution');
  assert.equal(process.env.DATABASE_HOST,'postgres-test','Refuse main/agent persistent DB');
  assert.equal(process.env.DATABASE_NAME,'life_dashboard_test','Refuse non-test database');
  guardSynthetic();
}
export function report(name:string,data:unknown) {mkdirSync(artifacts,{recursive:true});writeFileSync(`${artifacts}/${name}.json`,JSON.stringify(data,null,2)+'\n');}
export async function fixture() {
  guard();const pool=createPool();(guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));await seed(pool);
  const app=await buildApp(pool,{profile:'mvp',origin:'http://gateway-test'});
  const login=await app.inject({method:'POST',url:'/api/v1/session',headers:{origin:'http://gateway-test'},payload:{login_secret:process.env.LOCAL_LOGIN_SECRET}});
  assert.equal(login.statusCode,200,login.body);const cookie=String(login.headers['set-cookie']).split(';')[0];
  const request=(method:string,path:string,body?:any,key:string=randomUUID(),headers:Record<string,string>={})=>app.inject({method:method as any,url:'/api/v1/'+path,payload:body,headers:{cookie,origin:'http://gateway-test','idempotency-key':key,...headers}});
  const ok=async(method:string,path:string,body?:any,key?:string)=>{const r=await request(method,path,body,key);assert.equal(r.statusCode,200,r.body);return r.json().data;};
  return {pool,app,cookie,request,ok,close:async()=>{await app.close();await pool.end();}};
}
export const profileField=(module_id=DEFAULT_MODULE_IDS[0],changes:Record<string,unknown>={})=>({id:randomUUID(),module_id,key:'session',label:'资料时段',type:'text',kind:'profile',value:'真实资料',unit:null,options:[],...changes});
export async function graph(f:Awaited<ReturnType<typeof fixture>>) {
  const module_id=DEFAULT_MODULE_IDS[0],record_type_id=DEFAULT_TEMPLATE_IDS[0];
  const metric=await f.ok('POST','metrics',{id:randomUUID(),module_id,record_type_id,name:'独立验收次数',unit:'次',aggregation:'count',field_key:null,window:'all_time',timezone:'Asia/Shanghai'});
  const task=await f.ok('POST','tasks',{id:randomUUID(),module_id,title:'独立验收任务',completion_mode:'manual',record_type_id:null,acceptance:null,business_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),timezone:'Asia/Shanghai'});
  const achievement=await f.ok('POST','achievements',{id:randomUUID(),module_id,metric_id:metric.id,name:'独立验收成就',operator:'gte',threshold:'1'});
  const record=await f.ok('POST','records',{id:randomUUID(),module_id,record_type_id,schema_version:1,occurred_at:new Date().toISOString(),timezone:'Asia/Shanghai',status:'confirmed',values:{topic:'独立验收合成事实'},task_ids:[]});
  return {module_id,record_type_id,metric,task,achievement,record};
}
