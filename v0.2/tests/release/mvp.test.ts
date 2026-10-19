import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,type Page,type BrowserContext} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createPool} from '../../packages/db/src/client.js';
import {migrate} from '../../packages/db/src/migrate.js';
import {restoreUserData,exportUserData} from '../../packages/db/src/backup.js';
import {buildApp} from '../../apps/api/src/app.js';
const dir='.runtime/test-artifacts/stage3-final';mkdirSync(dir,{recursive:true});
const results:Record<string,unknown>={};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>Promise<boolean>,message:string){for(let n=0;n<100;n++){if(await check())return;await sleep(50);}throw Error(message);}

test('v0.1 release: isolated Chromium → gateway → API → PostgreSQL', {timeout:240000},async t=>{
  assert.equal(process.env.RELEASE_TEST,'1');assert.equal(process.env.DATABASE_NAME,'life_dashboard_release_test');assert.equal(process.env.DATABASE_HOST,'postgres');
  const pool=createPool(),browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  writeFileSync(dir+'/environment.json',JSON.stringify({node:process.version,browser:browser.version(),platform:process.platform,arch:process.arch,postgres:(await pool.query('SHOW server_version')).rows[0].server_version},null,2));
  const contexts:BrowserContext[]=[];
  let sessionCookies:Awaited<ReturnType<BrowserContext['cookies']>>=[];
  const errors:string[]=[];
  const fresh=async(forceLogin=false)=>{const c=await browser.newContext({baseURL:'http://gateway',acceptDownloads:true});contexts.push(c);if(!forceLogin&&sessionCookies.length)await c.addCookies(sessionCookies);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto('/');if(forceLogin||!sessionCookies.length){await p.locator('[name=login_secret]').fill(process.env.LOCAL_LOGIN_SECRET!);await p.locator('#ld-login-form button[type=submit]').click();sessionCookies=await c.cookies();}await p.locator('#ld-home-blank').waitFor();return p;};
  const goto=async(p:Page,path:string)=>{await p.goto(path);await p.locator('#ld-main-region').waitFor();};
  const click=async(p:Page,action:string)=>p.locator(`[data-action="${action}"]`).first().click();
  const finish=async(p:Page,form:string)=>{await p.locator(`${form} button[type=submit]`).click();await p.locator(form).waitFor({state:'detached'});};
  const call=async(p:Page,method:string,path:string,payload?:unknown)=>{const r=await p.context().request.fetch('/api/v1/'+path,{method,headers:{Origin:'http://gateway','Idempotency-Key':randomUUID()},...(payload===undefined?{}:{data:payload})});assert.equal(r.status(),200,await r.text());return (await r.json()).data;};
  const records=async(topic:string)=> (await pool.query("SELECT * FROM records WHERE values->>'topic'=$1 AND deleted_at IS NULL",[topic])).rows;
  const newRecord=async(p:Page,topic:string,minutes?:string)=>{await goto(p,'/records');await click(p,'open-create-record');await p.locator('[data-field-key=topic]').fill(topic);if(minutes!==undefined)await p.locator('[data-field-key=duration_minutes]').fill(minutes);};
  const pending=async(p:Page)=>p.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('life_dashboard_v0_1_pending_ops')??'{}'))[0] as any);
  const step=async(id:string,run:()=>Promise<void>)=>{let failure:unknown;await t.test(id,async()=>{try{await run();results[id]={status:'PASS'};}catch(e){failure=e;results[id]={status:'FAIL',message:(e as Error).message};await p?.screenshot({path:dir+'/failed-'+id+'.png',fullPage:true}).catch(()=>{});throw e;}finally{writeFileSync(dir+'/acceptance.json',JSON.stringify(results,null,2));}});if(failure)throw failure;};
  let p:Page,moduleId='',templateId='',metricId='',achievementId='',recordId='',taskIds:string[]=[];
  try {
    await step('A01',async()=>{
      for(const table of ['records','tasks','achievement_awards','ai_generation_jobs'])assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
      assert.equal((await pool.query('SELECT count(*)::int n FROM modules')).rows[0].n,4);assert.equal((await pool.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,2);
    });
    await step('A02',async()=>{
      const c=await browser.newContext({baseURL:'http://gateway'});contexts.push(c);
      assert.equal((await c.request.get('/api/v1/me')).status(),401);
      assert.equal((await c.request.post('/api/v1/session',{headers:{Origin:'http://evil.invalid'},data:{login_secret:'fixture'}})).status(),403);
      p=await fresh();assert.equal((await call(p,'GET','me')).name,'本地用户');
      const cookie=(await p.context().cookies()).find(c=>c.name==='life_session')!;assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'Strict');
      assert.match(readFileSync('compose.yaml','utf8'),/127\.0\.0\.1:18080:80/);
      await call(p,'DELETE','session');await p.reload();await p.locator('#ld-login-form').waitFor();p=await fresh(true);
    });
    await step('A03',async()=>{
      assert.equal((await p.locator('#ld-home-blank').innerHTML()).trim(),'');
      for(const route of ['/tasks','/records','/metrics','/achievements','/settings']){
        await goto(p,route);assert.equal(await p.locator('[data-action=open-ai-modal]').count(),0);assert.equal(await p.locator('[data-subtab=ai]').count(),0);assert.equal(await p.locator('[data-subtab=ai_review]').count(),0);
      }
      await p.screenshot({path:dir+'/desktop.png',fullPage:true});
    });
    await step('A04',async()=>{
      await goto(p,'/settings');await click(p,'open-create-module');await p.locator('#ld-form-create-module [name=name]').fill('验收学习模块');await finish(p,'#ld-form-create-module');
      moduleId=(await pool.query("SELECT id FROM modules WHERE name='验收学习模块'")).rows[0].id;
      await p.locator('[data-subtab=dependencies]').click();await click(p,'open-create-template');await p.locator('#ld-form-create-template [name=module_id]').selectOption(moduleId);await p.locator('#ld-form-create-template [name=name]').fill('验收实践模板');await finish(p,'#ld-form-create-template');
      templateId=(await pool.query("SELECT id FROM record_types WHERE name='验收实践模板'")).rows[0].id;
      for(let i=0;i<2;i++){
        await goto(p,'/tasks');await click(p,'open-create-task');await p.locator('#ld-task-module-select').selectOption(moduleId);await p.locator('#ld-form-create-task [name=title]').fill('验收十分钟任务'+i);await p.locator('#ld-task-acceptance-kind').selectOption('field_gte');await finish(p,'#ld-form-create-task');
      }
      taskIds=(await pool.query('SELECT id FROM tasks WHERE module_id=$1 ORDER BY id',[moduleId])).rows.map(r=>r.id);
      await goto(p,'/metrics');await click(p,'open-create-metric');await p.locator('#ld-metric-module-select').selectOption(moduleId);await p.locator('#ld-form-create-metric [name=name]').fill('验收学习分钟数');await p.locator('#ld-metric-agg-select').selectOption('sum');await finish(p,'#ld-form-create-metric');
      metricId=(await pool.query("SELECT id FROM metric_definitions WHERE definition->>'name'='验收学习分钟数'")).rows[0].id;
      const metric=(await call(p,'GET','metrics/'+metricId));assert.equal(metric.computed.value,null);
      await goto(p,'/achievements');await click(p,'open-create-achievement');await p.locator('#ld-ach-module-select').selectOption(moduleId);await p.locator('#ld-form-create-achievement [name=name]').fill('验收十分钟成就');await p.locator('#ld-form-create-achievement [name=threshold]').fill('10');await finish(p,'#ld-form-create-achievement');
      achievementId=(await pool.query("SELECT id FROM achievement_definitions WHERE definition->>'name'='验收十分钟成就'")).rows[0].id;
    });
    await step('A05',async()=>{
      await goto(p,'/tasks');await p.locator(`[data-action=task-go-record][data-task-id="${taskIds[0]}"]`).click();
      assert.equal(await p.locator('[data-field-key=duration_minutes]').inputValue(),'');await p.locator('[data-field-key=topic]').fill('验收闭环');await p.locator('[data-field-key=duration_minutes]').fill('5');
      for(const id of taskIds)await p.locator(`input[name=task_id][value="${id}"]`).check();await finish(p,'#ld-form-record');
      recordId=(await records('验收闭环'))[0].id;
      for(const id of taskIds)assert.equal((await call(p,'GET','tasks/'+id)).status,'partial');
      assert.equal((await call(p,'GET','metrics/'+metricId)).computed.value,'5');
      await goto(p,'/records');await p.locator(`[data-action=open-edit-record][data-record-id="${recordId}"]`).click();await p.locator('[data-field-key=duration_minutes]').fill('10');await finish(p,'#ld-form-record');
      for(const id of taskIds)assert.equal((await call(p,'GET','tasks/'+id)).status,'completed');
      const computed=(await call(p,'GET','metrics/'+metricId)).computed;assert.equal(computed.value,'10');assert.equal(computed.sample_count,1);
      assert.equal((await pool.query('SELECT state FROM achievement_awards WHERE achievement_id=$1',[achievementId])).rows[0].state,'unlocked');
    });
    await step('A06',async()=>{
      await goto(p,'/records');await p.locator(`[data-action=open-record-detail][data-record-id="${recordId}"]`).click();await p.locator('[data-action=delete-record]').click();
      await until(async()=>(await pool.query('SELECT deleted_at FROM records WHERE id=$1',[recordId])).rows[0].deleted_at!==null,'record tombstone missing');
      assert.equal((await call(p,'GET','tasks/'+taskIds[0])).needs_review,true);assert.equal((await pool.query('SELECT state FROM achievement_awards WHERE achievement_id=$1',[achievementId])).rows[0].state,'needs_review');
      assert.equal((await call(p,'GET','metrics/'+metricId)).computed.value,null);
      await newRecord(p,'验收真实零','0');await p.locator('#ld-record-module-select').selectOption(moduleId);await p.locator('[data-field-key=topic]').fill('验收真实零');await p.locator('[data-field-key=duration_minutes]').fill('0');await finish(p,'#ld-form-record');assert.equal((await call(p,'GET','metrics/'+metricId)).computed.value,'0');
    });
    await step('A07',async()=>{
      p=await fresh();await newRecord(p,'刷新恢复草稿','3');await p.reload();await click(p,'resume-latest-draft');assert.equal(await p.locator('[data-field-key=topic]').inputValue(),'刷新恢复草稿');
      await p.locator('[data-field-key=topic]').fill('输入保持');await p.locator('[data-action=close-modal]').first().click();await click(p,'resume-latest-draft');assert.equal(await p.locator('[data-field-key=topic]').inputValue(),'输入保持');
    });
    await step('A08',async()=>{
      p=await fresh();await newRecord(p,'丢回执刷新','4');let committed!:()=>void;const done=new Promise<void>(r=>{committed=r;});let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
      await p.route('**/api/v1/records',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}await route.fetch();committed();await gate;await route.abort().catch(()=>{});});
      await p.locator('#ld-record-submit-btn').click();await done;
      const frozen=await pending(p);assert.ok(frozen?.operationId,'M1: pending must exist while request still in flight');assert.equal((await records('丢回执刷新')).length,1);
      await p.reload();release();await p.unrouteAll({behavior:'wait'});await click(p,'resume-latest-draft');assert.equal((await pending(p)).operationId,frozen.operationId);
      await finish(p,'#ld-form-record');assert.equal((await records('丢回执刷新')).length,1);assert.equal((await pool.query('SELECT count(*)::int n FROM mutation_receipts WHERE operation_id=$1',[frozen.operationId])).rows[0].n,1);
    });
    await step('A09',async()=>{
      p=await fresh();await newRecord(p,'未知后改值旧','5');const sent:any[]=[];
      await p.route('**/api/v1/records',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});await route.fetch();await route.abort();});
      await p.locator('#ld-record-submit-btn').click();await p.locator('[data-submission-status=unknown_network]').waitFor();
      const before=await pending(p);await p.locator('[data-field-key=topic]').fill('未知后改值新');await p.locator('[name=occurred_at]').fill('2026-10-18T12:00:00Z');await p.locator('[name=timezone]').fill('UTC');assert.deepEqual(await pending(p),before);
      await p.unrouteAll();await p.locator('#ld-record-submit-btn').click();await p.locator('#ld-form-record[data-mode=edit]').waitFor();
      assert.equal((await records('未知后改值旧')).length,1);assert.equal((await records('未知后改值新')).length,0);assert.equal(await p.locator('[data-field-key=topic]').inputValue(),'未知后改值新');
      const oldId=(await records('未知后改值旧'))[0].id;await finish(p,'#ld-form-record');const changed=(await records('未知后改值新'))[0];assert.equal(changed.id,oldId);assert.equal(changed.timezone,'UTC');assert.equal((await records('未知后改值旧')).length,0);assert.equal(sent.length,1);
    });
    await step('A10',async()=>{
      p=await fresh();await newRecord(p,'损坏成功回执','2');let original:any;
      await p.route('**/api/v1/records',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}original={key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()};await route.fetch();await route.fulfill({status:200,contentType:'application/json',body:'broken-json'});});
      await p.locator('#ld-record-submit-btn').click();await p.locator('[data-submission-status=unknown_network]').waitFor();const frozen=await pending(p);assert.equal(frozen.operationId,original.key);assert.deepEqual(frozen.frozenPayload,original.body);
      await p.unrouteAll();let replay:any;await p.route('**/api/v1/records',async route=>{replay={key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()};await route.continue();});await finish(p,'#ld-form-record');assert.deepEqual(replay,original);assert.equal((await records('损坏成功回执')).length,1);
    });
    await step('A11',async()=>{
      p=await fresh();await p.context().addInitScript(()=>{const old=Storage.prototype.setItem;(window as any).__allowStorage=false;Storage.prototype.setItem=function(k,v){if(!(window as any).__allowStorage&&/record_drafts|pending_ops/.test(k))throw new DOMException('quota','QuotaExceededError');return old.call(this,k,v);};});
      await newRecord(p,'不可存储不发送','3');await p.locator('#ld-record-submit-btn').click();await p.getByText('未保存本机',{exact:true}).first().waitFor();assert.equal((await records('不可存储不发送')).length,0);assert.equal(await p.locator('[data-field-key=topic]').inputValue(),'不可存储不发送');
      await p.evaluate(()=>{(window as any).__allowStorage=true;});await finish(p,'#ld-form-record');assert.equal((await records('不可存储不发送')).length,1);
    });
    await step('A12',async()=>{
      p=await fresh();await newRecord(p,'双页冲突原值','2');await finish(p,'#ld-form-record');const id=(await records('双页冲突原值'))[0].id;
      await p.locator(`[data-action=open-edit-record][data-record-id="${id}"]`).click();await p.locator('[data-field-key=topic]').fill('双页冲突本地');
      const other=await fresh();await goto(other,'/records');await other.locator(`[data-action=open-edit-record][data-record-id="${id}"]`).click();await other.locator('[data-field-key=topic]').fill('双页冲突服务器');await finish(other,'#ld-form-record');
      await p.reload();await click(p,'resume-latest-draft');assert.equal(await p.locator('#ld-form-record').getAttribute('data-base-version'),'1');await p.locator('#ld-record-submit-btn').click();await p.locator('[data-conflict-code=VERSION_CONFLICT]').waitFor();assert.equal(await p.locator('[data-field-key=topic]').inputValue(),'双页冲突本地');
      await click(p,'conflict-pull-latest');await p.locator('[data-action=conflict-adopt-version]').waitFor();assert.equal(await p.locator('#ld-form-record').getAttribute('data-base-version'),'1');await click(p,'conflict-adopt-version');assert.equal(await p.locator('#ld-form-record').getAttribute('data-base-version'),'2');await finish(p,'#ld-form-record');assert.equal((await records('双页冲突本地'))[0].version,3);
    });
    await step('A13',async()=>{
      await goto(p,'/settings');await p.locator('[data-subtab=account]').click();const downloadPromise=p.waitForEvent('download');await click(p,'export-data');const download=await downloadPromise;await download.saveAs(dir+'/browser-export.json');const backup=JSON.parse(readFileSync(dir+'/browser-export.json','utf8'));assert.ok(backup.data.record_revisions.length>0);assert.ok(backup.data.records.some((r:any)=>r.deleted_at));assert.ok(!('sessions'in backup.data));
      await pool.query('CREATE DATABASE life_dashboard_release_restore');const old=process.env.DATABASE_NAME;process.env.DATABASE_NAME='life_dashboard_release_restore';const restored=createPool();process.env.DATABASE_NAME=old;
      try{
        await migrate(restored);const tampered=structuredClone(backup);tampered.checksum='bad';await assert.rejects(restoreUserData(restored,tampered));
        const cli=spawnSync('node_modules/.bin/tsx',['scripts/restore-data.ts','--file',dir+'/browser-export.json'],{env:{...process.env,DATABASE_NAME:'life_dashboard_release_restore'},encoding:'utf8'});writeFileSync(dir+'/restore-cli.log',(cli.stdout??'')+(cli.stderr??''));assert.equal(cli.status,0,cli.stderr);
        assert.deepEqual((await exportUserData(restored,backup.user.id)).data,backup.data);await assert.rejects(restoreUserData(restored,backup));
        const session=(await restored.query('SELECT count(*)::int n FROM sessions')).rows[0].n;assert.equal(session,0);
        const app=await buildApp(restored,{profile:'mvp'});try{const login=await app.inject({method:'POST',url:'/api/v1/session',headers:{origin:'http://gateway'},payload:{login_secret:process.env.LOCAL_LOGIN_SECRET}});assert.equal(login.statusCode,200);const cookie=String(login.headers['set-cookie']).split(';')[0];const snapshot=await app.inject({url:'/api/v1/bootstrap',headers:{cookie}});assert.equal(snapshot.statusCode,200);assert.equal(snapshot.json().data.records.length,backup.data.records.filter((r:any)=>!r.deleted_at).length);}finally{await app.close();}
      }finally{await restored.end();await pool.query('DROP DATABASE life_dashboard_release_restore');}
      writeFileSync(dir+'/restart-probe.json',JSON.stringify({id:(await records('双页冲突本地'))[0].id}));
    });
    await step('A14',async()=>{
      for(const path of ['ai/generations',`ai/generations/${randomUUID()}/apply`,`ai/batches/${randomUUID()}/revoke`]){const r=await p.context().request.post('/api/v1/'+path,{headers:{Origin:'http://gateway'},data:{}});assert.equal(r.status(),409);assert.equal((await r.json()).error.code,'FEATURE_DISABLED');}
      assert.equal((await pool.query('SELECT count(*)::int n FROM ai_generation_jobs')).rows[0].n,0);
    });
    await step('A15',async()=>{
      p=await fresh();await p.setViewportSize({width:360,height:780});await newRecord(p,'360视口真实提交','1');await p.locator('#ld-record-submit-btn').scrollIntoViewIfNeeded();const box=await p.locator('#ld-record-submit-btn').boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=361&&box.y>=0&&box.y+box.height<=780);
      const hit=await p.locator('#ld-record-submit-btn').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});assert.equal(hit,true);await p.screenshot({path:dir+'/mobile-360.png',fullPage:true});await finish(p,'#ld-form-record');assert.equal((await records('360视口真实提交')).length,1);
    });
    assert.deepEqual(errors,[],'Browser page exceptions');
  }finally{for(const c of contexts)await c.close();await browser.close();await pool.end();writeFileSync(dir+'/acceptance.json',JSON.stringify(results,null,2));}
});
