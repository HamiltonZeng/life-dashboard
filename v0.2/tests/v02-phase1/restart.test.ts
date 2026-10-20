import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {guard,report,artifacts,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from './support.js';

test('R01 profile preferences records and minimal UI survive service restart',async()=>{
  guard();const mode=process.env.PHASE1_RESTART_MODE;assert.ok(mode==='prepare'||mode==='check');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    const context=await browser.newContext({baseURL:'http://gateway'});
    const login=await context.request.post('/api/v1/session',{headers:{Origin:'http://gateway'},data:{login_secret:process.env.LOCAL_LOGIN_SECRET}});assert.equal(login.status(),200);
    const call=async(method:string,path:string,data?:any)=>{const r=await context.request.fetch('/api/v1/'+path,{method,headers:{Origin:'http://gateway','Idempotency-Key':randomUUID()},...(data?{data}:{})});assert.equal(r.status(),200,await r.text());return (await r.json()).data;};
    if(mode==='prepare') {
      const p=await call('GET','profile'),pref=await call('GET','home-preferences');
      const profile=await call('PATCH','profile',{base_version:p.version,bio:'重启验证合成资料'});
      const preferences=await call('PATCH','home-preferences',{base_version:pref.version,minimal_mode:true});
      const record=await call('POST','records',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],schema_version:1,occurred_at:new Date().toISOString(),timezone:'Asia/Shanghai',status:'confirmed',values:{topic:'重启验证合成记录'},task_ids:[]});
      report('restart-probe',{profile,preferences,record});
    } else {
      const probe=JSON.parse(readFileSync(artifacts+'/restart-probe.json','utf8'));
      assert.deepEqual(await call('GET','profile'),probe.profile);assert.deepEqual(await call('GET','home-preferences'),probe.preferences);assert.deepEqual(await call('GET','records/'+probe.record.id),probe.record);
      const page=await context.newPage();await page.goto('/');await page.locator('#ld-home-minimal').waitFor();assert.equal(await page.locator('#ld-home-avatar-slot').count(),0);assert.equal(await page.locator('#ld-home-ai-send-btn').isDisabled(),true);await page.screenshot({path:artifacts+'/restart-minimal.png',fullPage:true});
      report('restart',{status:'PASS',profile_version:probe.profile.version,preferences_version:probe.preferences.version,record_retained:true,minimal_ui:true});
    }
  } finally {await browser.close();}
});
