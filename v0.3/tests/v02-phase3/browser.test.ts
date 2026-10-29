import {guardSynthetic} from '../v02-phase3/guard.js';
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {chromium} from 'playwright';import {createPool} from '../../packages/db/src/client.js';import {seed,DEFAULT_MODULE_IDS} from '../../packages/db/src/seed.js';
const dir='.runtime/test-artifacts/v02-phase3',clock=dir+'/clock.json';mkdirSync(dir,{recursive:true});
test('R01 normal login, foreground and rollover materialize current periods without GET writes',{timeout:60000},async()=>{
 assert.equal(process.env.PHASE3_ACCEPTANCE,'codex-phase3');assert.equal(process.env.ACCEPTANCE_PROJECT,'life-dashboard-v0-3');assert.equal(process.env.DATABASE_HOST,'postgres-test');assert.equal(process.env.DATABASE_NAME,'life_dashboard_v03_test');
 const pool=createPool();(guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));await seed(pool);writeFileSync(clock,JSON.stringify({now:'2030-01-31T12:00:00Z'}));const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({baseURL:'http://gateway-test'});
 const call=async(method:string,path:string,body?:any)=>{const r=await ctx.request.fetch('/api/v1/'+path,{method,headers:{Origin:'http://gateway-test','idempotency-key':randomUUID()},data:body});assert.equal(r.status(),200,await r.text());return (await r.json()).data;};
 try{await call('POST','session',{login_secret:process.env.LOCAL_LOGIN_SECRET});const t=await call('POST','task-templates',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],title:'rollover synthetic daily',category:'daily',timezone:'Asia/Shanghai',completion_mode:'manual',rule:null});
 writeFileSync(clock,JSON.stringify({now:'2030-02-01T12:00:00Z'}));const p=await ctx.newPage();p.on('pageerror',e=>console.log('PAGE ERROR '+e.message));await p.goto('/');await p.locator('#ld-main-region').waitFor({timeout:7000}).catch(async error=>{console.log((await p.locator('body').innerText()).slice(0,1500));throw error;});
 await p.waitForFunction(()=>[...document.querySelectorAll('[data-home-task-card]')].length===1,{},{timeout:5000});const ids=(await pool.query("SELECT task_id FROM task_instance_details WHERE template_id=$1 AND period_start='2030-01-31T16:00:00Z'",[t.template.id])).rows;assert.equal(ids.length,1);assert.notEqual(ids[0].task_id,t.instance.id);
 // Open tab crosses the exact deadline without a manual generate action.
 await p.clock.install();writeFileSync(clock,JSON.stringify({now:'2030-02-01T16:00:00Z'}));await p.clock.fastForward(4*3600000);
 await p.waitForFunction(async()=>{const r=await fetch('/api/v1/task-instances');return (await r.json()).data.some((t:any)=>t.period.start==='2030-02-01T16:00:00.000Z');},{},{timeout:8000});
 // Foreground recovery and a second tab both converge on a single current instance.
 writeFileSync(clock,JSON.stringify({now:'2030-02-03T12:00:00Z'}));await p.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const second=await ctx.newPage();await second.goto('/tasks');await second.locator('#ld-main-region').waitFor();
 await second.waitForFunction(async()=>{const r=await fetch('/api/v1/task-instances');return (await r.json()).data.some((t:any)=>t.period.start==='2030-02-02T16:00:00.000Z');},{},{timeout:8000});
 assert.equal((await pool.query("SELECT count(*) FROM task_instance_details WHERE template_id=$1 AND period_start='2030-02-02T16:00:00Z'",[t.template.id])).rows[0].count,'1');
 const before=(await call('GET','export')).data;await call('GET','home');await call('GET','task-instances');assert.deepEqual((await call('GET','export')).data,before);

 }finally{await ctx.close();await browser.close();await pool.end();if(existsSync(clock))unlinkSync(clock);}
});
test('R03 two-tab binding conflict preserves draft after reload and requires explicit adoption',{timeout:45000},async()=>{
 guardSynthetic();const pool=createPool();await pool.query('TRUNCATE users CASCADE');await seed(pool);const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({baseURL:'http://gateway-test'});
 const call=async(method:string,path:string,body?:any)=>{const r=await ctx.request.fetch('/api/v1/'+path,{method,headers:{Origin:'http://gateway-test','idempotency-key':randomUUID()},data:body});assert.equal(r.status(),200,await r.text());return (await r.json()).data;};
 try{
 await call('POST','session',{login_secret:process.env.LOCAL_LOGIN_SECRET});const module_id=DEFAULT_MODULE_IDS[0];const source=await call('POST','record-types',{id:randomUUID(),module_id,name:'synthetic binding UI',fields:[{key:'x',label:'x',type:'integer',unit:'次',required:false},{key:'y',label:'y',type:'integer',unit:'次',required:false}]});
 const field={id:randomUUID(),module_id,key:'obs',label:'synthetic binding observation',kind:'observation',type:'integer',unit:'次',value:null,options:[],binding:{record_type_id:source.id,field_key:'x'}};
 await call('PATCH','profile',{base_version:1,field_upserts:[field]});const p=await ctx.newPage();await p.goto('/settings');await p.locator('[data-subtab=profile]').click();await p.locator(`[data-action=open-write-observation][data-field-id="${field.id}"][data-obs-mode=new]`).click();await p.locator('#ld-form-write-observation [name=value]').fill('17');
 // Another tab edits the configuration while the first tab retains an old frozen mapping.
 await call('PATCH','profile',{base_version:2,field_upserts:[{...field,binding:{record_type_id:source.id,field_key:'y'}}]});await p.reload();await p.locator('[data-subtab=profile]').click();await p.locator(`[data-action=open-write-observation][data-field-id="${field.id}"][data-obs-mode=new]`).click();const form=p.locator('#ld-form-write-observation');assert.equal(await form.locator('[name=value]').inputValue(),'17');
 await form.locator('button[type=submit]').click();const conflict=form.locator('.ld-conflict-panel').filter({hasText:'绑定已改变'});await conflict.waitFor();assert.match(await conflict.innerText(),/x.*y/);assert.equal((await pool.query('SELECT count(*) FROM records')).rows[0].count,'0');assert.equal(await form.locator('[name=value]').inputValue(),'17');
 await form.locator('[data-action=observation-adopt-binding]').click();await form.locator('button[type=submit]').click();await form.waitFor({state:'detached'});const records=(await pool.query('SELECT values FROM records')).rows;assert.equal(records.length,1);assert.equal(records[0].values.y,17);assert.equal(records[0].values.x,undefined);
 }finally{await ctx.close();await browser.close();await pool.end();}
});
