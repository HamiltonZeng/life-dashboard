import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {chromium} from 'playwright';import {DEFAULT_MODULE_IDS} from '../../packages/db/src/seed.js';
assert.equal(process.env.DATABASE_HOST,'postgres-test');assert.equal(process.env.DATABASE_NAME,'life_dashboard_v03_test');assert.equal(process.env.PHASE2_BROWSER,'isolated');
const dir='.runtime/test-artifacts/v02-phase3/web';mkdirSync(dir,{recursive:true});const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const c=await browser.newContext({baseURL:'http://gateway-test'});
try{
 const login=await c.request.post('/api/v1/session',{headers:{Origin:'http://gateway-test'},data:{login_secret:process.env.LOCAL_LOGIN_SECRET}});assert.equal(login.status(),200);
 const call=async(method:string,path:string,body?:any,key=randomUUID())=>{const r=await c.request.fetch('/api/v1/'+path,{method,headers:{Origin:'http://gateway-test','idempotency-key':key},data:body});assert.equal(r.status(),200,await r.text());return r.json();};
 if(process.argv[2]==='prepare'){
  const template={id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],title:'重启验收合成主线',category:'main',timezone:'Asia/Shanghai',completion_mode:'manual',rule:null,color:'blue'},key=randomUUID();
  const first=await call('POST','task-templates',template,key),body={base_version:first.data.instance.version},completeKey=randomUUID(),complete=await call('POST','tasks/'+first.data.instance.id+'/complete',body,completeKey);
  const exported=(await call('GET','export')).data;
  writeFileSync(dir+'/restart-state.json',JSON.stringify({template,key,first,body,completeKey,complete,exported}),{mode:0o600});console.log('restart preparation PASS');
 }else{
  const before=JSON.parse(readFileSync(dir+'/restart-state.json','utf8'));
  assert.deepEqual(await call('POST','task-templates',before.template,before.key),before.first);assert.deepEqual(await call('POST','tasks/'+before.first.data.instance.id+'/complete',before.body,before.completeKey),before.complete);
  const current=(await call('GET','export')).data;assert.deepEqual(current.data,before.exported.data);assert.deepEqual(current.migrations,before.exported.migrations);
  const p=await c.newPage();await p.goto('/tasks');await p.locator(`[data-task-card="${before.first.data.instance.id}"][data-task-status=completed]`).waitFor();
  writeFileSync(dir+'/restart.json',JSON.stringify({status:'PASS',export_unchanged:true,original_operations_replayed:true,duplicate_rewards:false,ui_completed_task:true}));console.log('browser/API restart, exact replay and no duplicate rewards PASS');
 }
}finally{await c.close();await browser.close();}
