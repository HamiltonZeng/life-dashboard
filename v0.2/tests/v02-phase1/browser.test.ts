import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,type Page,type BrowserContext} from 'playwright';
import {randomUUID} from 'node:crypto';
import {fixture,graph,guard,profileField,report,artifacts,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from './support.js';

class Blocked extends Error {}
async function until(check:()=>boolean,message:string){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,50));}throw Error(message);}
const ids=['B01','B02','B03','B04','B05','B06','B07','B08','B09','B10'];
const results:Record<string,any>=Object.fromEntries(ids.map(id=>[id,{status:'BLOCKED',reason:'not executed'}]));
const observations:Record<string,unknown>={};
const locators={ai:'[data-testid=home-ai-container], [data-home-ai-container]',avatar:'[data-testid=home-avatar], [data-avatar-placeholder]',profile:'form:has([name=nickname])',minimal:'input[name=minimal_mode], [data-action=toggle-minimal-mode]'};
async function requireVisible(p:Page,selector:string,reason:string) {if(!await p.locator(selector).first().isVisible())throw new Blocked(reason);}
async function openProfile(p:Page) {
  await p.goto('/settings');await p.locator('#ld-main-region').waitFor();
  if(!await p.locator(locators.profile).count()) {
    const entry=p.getByRole('button',{name:/个人信息|个人资料/}).or(p.getByRole('link',{name:/个人信息|个人资料/})).first();
    if(!await entry.count())throw new Blocked('Gemini profile page/navigation is not implemented');
    await entry.click();
  }
  await requireVisible(p,locators.profile,'Profile form is unavailable');
}
async function saveProfile(p:Page) {await p.locator(locators.profile).getByRole('button',{name:/保存|确认/}).first().click();}

// Browser tests run only against the synthetic test database using the test-only overlay.
test('DeepSeek phase-one real Chromium acceptance',{timeout:180000},async t=>{
  guard();report('browser',results);const f=await fixture();let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;const contexts:BrowserContext[]=[];const errors:string[]=[];let cookies:Awaited<ReturnType<BrowserContext['cookies']>>=[];
  const scenario=async(id:string,run:(p:Page)=>Promise<void>)=>t.test(id,async()=>{
    const c=await browser!.newContext({baseURL:'http://gateway',viewport:{width:1280,height:900}});contexts.push(c);await c.addCookies(cookies);const p=await c.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));
    try{await p.goto('/');await p.locator('#ld-main-region').waitFor();await run(p);results[id]={status:'PASS'};}
    catch(e){results[id]={status:e instanceof Blocked?'BLOCKED':'FAIL',reason:(e as Error).message,observations:observations[id]};await p.screenshot({path:`${artifacts}/${id}.png`,fullPage:true}).catch(()=>{});throw e;}
    finally{report('browser',results);await c.close();}
  });
  try {
    const g=await graph(f);
    const field=profileField();await f.ok('PATCH','profile',{base_version:1,nickname:'浏览器合成用户',field_upserts:[field]});
    await f.ok('PATCH','home-preferences',{base_version:1,pinned_metric_ids:[g.metric.id],pinned_task_ids:[g.task.id]});
    const rt=await f.ok('POST','record-types',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],name:'session 业务模板',fields:[{key:'session',label:'学习时段',type:'text',required:true}]});
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    report('environment',{node:process.version,browser:browser.version(),postgres:(await f.pool.query('SHOW server_version')).rows[0].server_version,origin:'http://gateway',database_host:process.env.DATABASE_HOST,database_name:process.env.DATABASE_NAME,locators,independent_author:false});
    const auth=await browser.newContext({baseURL:'http://gateway'});contexts.push(auth);
    const login=await auth.request.post('/api/v1/session',{headers:{Origin:'http://gateway'},data:{login_secret:process.env.LOCAL_LOGIN_SECRET}});assert.equal(login.status(),200);cookies=await auth.cookies();

    await scenario('B01',async p=>{
      await p.goto('/records');await p.locator('[data-action=open-create-record]').first().click();
      await p.locator('#ld-record-module-select').selectOption(DEFAULT_MODULE_IDS[0]);
      await p.locator('#ld-record-template-select').selectOption(rt.id);
      const value='业务session-'+randomUUID();await p.locator('[data-field-key=session]').fill(value);
      await p.locator('#ld-record-submit-btn').click();
      await p.waitForFunction(()=>!document.querySelector('#ld-record-submit-btn[disabled]'));
      const count=(await f.pool.query("SELECT count(*)::int n FROM records WHERE values->>'session'=$1",[value])).rows[0].n;
      observations.B01={persisted_records:count,storage_error_visible:await p.getByText('未保存本机',{exact:true}).count()};
      assert.equal(count,1,'Legal business values.session must persist and submit successfully');
    });
    await scenario('B02',async p=>{
      await p.goto('/settings');await p.locator('[data-action=open-create-module]').click();
      const name='丢回执配置-'+randomUUID();await p.locator('#ld-form-create-module [name=name]').fill(name);
      const sent:{key:string;body:any}[]=[];let completed=0;
      await p.route('**/api/v1/modules',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});await route.fetch();await route.abort();completed++;});
      await p.locator('#ld-form-create-module button[type=submit]').click();
      await until(()=>completed===1,'First config request did not complete');
      await p.waitForFunction(()=>!document.querySelector('#ld-form-create-module button[disabled]'));
      assert.equal((await f.pool.query('SELECT count(*)::int n FROM modules WHERE name=$1',[name])).rows[0].n,1,'Server must commit before response loss');
      // Repeating the unchanged form is the first required recovery path; capture both requests.
      await p.locator('#ld-form-create-module button[type=submit]').click();
      await until(()=>completed===2,'Second config request did not complete');
      await p.waitForFunction(()=>!document.querySelector('#ld-form-create-module button[disabled]'));
      observations.B02={requests:sent.length,keys:sent.map(x=>x.key),entity_ids:sent.map(x=>x.body.id),modules_with_same_name:(await f.pool.query('SELECT count(*)::int n FROM modules WHERE name=$1',[name])).rows[0].n};
      assert.equal(sent.length,2);assert.equal(sent[1].key,sent[0].key,'Unknown config retry must retain Idempotency-Key');assert.deepEqual(sent[1].body,sent[0].body,'Unknown config retry must retain complete payload and entity ID');
      assert.equal((await f.pool.query('SELECT count(*)::int n FROM modules WHERE name=$1',[name])).rows[0].n,1);
      // Reload while response remains unknown; the operation must remain recoverable.
      await p.locator('#ld-form-create-module [name=name]').fill(name+'-当前草稿');
      await p.reload();const recovery=p.getByRole('button',{name:/确认上次|恢复.*配置|继续.*配置/}).first();
      if(!await recovery.count())throw new Blocked('Reload recovery entry for frozen configuration operation is unavailable');
      await p.unrouteAll();await recovery.click();
      assert.equal((await f.pool.query('SELECT count(*)::int n FROM modules WHERE name=$1',[name])).rows[0].n,1);
    });
    await scenario('B03',async p=>{
      await requireVisible(p,locators.ai,'Standard homepage/AI disabled container has not been implemented');
      assert.match(await p.locator('main').innerText(),/浏览器合成用户/);
      assert.match(await p.locator('main').innerText(),/独立验收次数/);
      assert.match(await p.locator('main').innerText(),/独立验收任务/);
      assert.match(await p.locator('main').innerText(),/独立验收成就/);
    });
    await scenario('B04',async p=>{
      await openProfile(p);const bio=p.locator(locators.profile+' [name=bio]');await bio.fill('失败时保留输入');
      await p.route('**/api/v1/profile',async route=>route.request().method()==='PATCH'?route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:{code:'INVALID_FIELD',message:'synthetic validation failure'}})}):route.continue());
      const rejected=p.waitForResponse(r=>r.url().endsWith('/api/v1/profile')&&r.request().method()==='PATCH');await saveProfile(p);assert.equal((await rejected).status(),422);assert.equal(await bio.inputValue(),'失败时保留输入');await p.unrouteAll();
      const current=await f.ok('GET','profile');await f.ok('PATCH','profile',{base_version:current.version,bio:'服务器新基线'});
      const sent:any[]=[];await p.route('**/api/v1/profile',async route=>{if(route.request().method()==='PATCH')sent.push(route.request().postDataJSON());await route.continue();});
      const conflict=p.waitForResponse(r=>r.url().endsWith('/api/v1/profile')&&r.request().method()==='PATCH');await saveProfile(p);assert.equal((await conflict).status(),409);assert.equal(await bio.inputValue(),'失败时保留输入');
      const adopt=p.getByRole('button',{name:/采用.*版本|采用.*基线/}).first();await adopt.waitFor();assert.equal(sent[0].base_version,current.version);
      await adopt.click();const success=p.waitForResponse(r=>r.url().endsWith('/api/v1/profile')&&r.request().method()==='PATCH');await saveProfile(p);assert.equal((await success).status(),200);assert.equal(sent.at(-1).base_version,current.version+1);
    });
    await scenario('B05',async p=>{
      await openProfile(p);await p.locator(locators.profile+' [name=bio]').fill('尚未保存');
      const dialog=p.waitForEvent('dialog');const navigation=p.goto('/tasks').catch(()=>{});const d=await dialog;assert.equal(d.type(),'beforeunload');await d.dismiss();await navigation.catch(()=>{});assert.equal(await p.locator(locators.profile+' [name=bio]').inputValue(),'尚未保存');
    });
    await scenario('B06',async p=>{
      await p.goto('/settings');await p.locator('#ld-main-region').waitFor();
      const display=p.getByRole('button',{name:/显示|首页/}).first();if(!await p.locator(locators.minimal).count()&&await display.count())await display.click();
      await requireVisible(p,locators.minimal,'Persistent minimal-mode setting has not been implemented');
      const before=await f.ok('GET','home-preferences');const saved=p.waitForResponse(r=>r.url().endsWith('/api/v1/home-preferences')&&r.request().method()==='PATCH');await p.locator(locators.minimal).first().click();assert.equal((await saved).status(),200);await p.goto('/');await requireVisible(p,locators.ai,'Minimal mode AI container missing');await p.reload();
      const after=await f.ok('GET','home-preferences');assert.equal(after.minimal_mode,true);assert.deepEqual(after.pinned_metric_ids,before.pinned_metric_ids);assert.deepEqual(after.pinned_task_ids,before.pinned_task_ids);
      assert.equal(await p.locator(locators.avatar).count(),0);const box=await p.locator(locators.ai).first().boundingBox();assert.ok(box);assert.ok(Math.abs(box.x+box.width/2-640)<50,'AI container must be horizontally centered');
    });
    await scenario('B07',async p=>{
      const pref=await f.ok('GET','home-preferences');await f.ok('PATCH','home-preferences',{base_version:pref.version,minimal_mode:false});await p.reload();
      await requireVisible(p,locators.ai,'Homepage source cards are unavailable');
      const metric=p.getByText('独立验收次数',{exact:true}).first();await metric.click();assert.match(new URL(p.url()).pathname,/metrics/);assert.match(await p.locator('#ld-main-region').innerText(),/独立验收次数/);
      await p.goto('/');await p.getByText('独立验收任务',{exact:true}).first().click();assert.match(new URL(p.url()).pathname,/tasks/);
    });
    await scenario('B08',async p=>{
      const resources:string[]=[];const mutations:string[]=[];p.on('request',r=>{resources.push(r.url());if(r.method()==='POST'&&/\/api\/v1\/ai\//.test(r.url()))mutations.push(r.url());});await p.reload();
      await requireVisible(p,locators.ai,'Disabled AI draft container has not been implemented');await requireVisible(p,locators.avatar,'Static 3D fallback has not been implemented');
      const input=p.locator(locators.ai).first().locator('textarea,input[type=text]').first();await input.fill('不能发送的本机草稿');await p.waitForFunction(()=>Object.values(localStorage).some(v=>String(v).includes('不能发送的本机草稿')));await p.reload();assert.equal(await input.inputValue(),'不能发送的本机草稿');
      const send=p.locator(locators.ai).first().getByRole('button',{name:/发送/});assert.equal(await send.isDisabled(),true);
      assert.equal(resources.filter(u=>/\.(glb|gltf|fbx|obj|wasm)(\?|$)/i.test(u)).length,0);assert.deepEqual(mutations,[]);assert.equal(await p.getByRole('button',{name:/兑换/}).count(),0);
    });
    await scenario('B09',async p=>{
      await p.goto('/records');await p.locator('[data-action=open-create-record]').first().click();await p.locator('#ld-record-module-select').selectOption(DEFAULT_MODULE_IDS[0]);await p.locator('#ld-record-template-select').selectOption(DEFAULT_TEMPLATE_IDS[0]);
      const value='旧记录幂等-'+randomUUID();await p.locator('[data-field-key=topic]').fill(value);
      const sent:any[]=[];await p.route('**/api/v1/records',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});await route.fetch();await route.abort();});
      await p.locator('#ld-record-submit-btn').click();await p.locator('[data-submission-status=unknown_network]').waitFor();
      await p.reload();await p.locator('[data-action=resume-latest-draft]').click();await p.unrouteAll();
      await p.route('**/api/v1/records',async route=>{if(route.request().method()==='POST')sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});await route.continue();});
      await p.locator('#ld-record-submit-btn').click();await p.locator('#ld-form-record').waitFor({state:'detached'});assert.deepEqual(sent[1],sent[0]);assert.equal((await f.pool.query("SELECT count(*)::int n FROM records WHERE values->>'topic'=$1",[value])).rows[0].n,1);
    });
    await scenario('B10',async p=>{
      await p.context().addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(/record_drafts|pending_ops/.test(k))throw new DOMException('synthetic failure','QuotaExceededError');return original.call(this,k,v);};});
      await p.goto('/records');await p.locator('[data-action=open-create-record]').first().click();await p.locator('#ld-record-module-select').selectOption(DEFAULT_MODULE_IDS[0]);await p.locator('#ld-record-template-select').selectOption(DEFAULT_TEMPLATE_IDS[0]);
      const value='存储失败不发送-'+randomUUID();await p.locator('[data-field-key=topic]').fill(value);await p.locator('#ld-record-submit-btn').click();await p.getByText('未保存本机',{exact:true}).first().waitFor();assert.equal(await p.locator('[data-field-key=topic]').inputValue(),value);assert.equal((await f.pool.query("SELECT count(*)::int n FROM records WHERE values->>'topic'=$1",[value])).rows[0].n,0);
    });
    assert.deepEqual(errors,[],'Uncaught browser errors');
  } catch(e) {report('browser-infrastructure',{status:'FAIL',message:(e as Error).message});throw e;}
  finally{report('browser',results);report('browser-errors',errors);for(const c of contexts)await c.close().catch(()=>{});await browser?.close();await f.close();}
});
