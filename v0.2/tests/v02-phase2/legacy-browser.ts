import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,type Page,type BrowserContext} from 'playwright';
import {randomUUID} from 'node:crypto';
import {seed} from '../../packages/db/src/seed.js';
import {fixture,graph,guard,profileField,report,artifacts,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from './legacy-support.js';

class Blocked extends Error {}
async function until(check:()=>boolean,message:string){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,50));}throw Error(message);}
const ids=['B01','B02','B03','B04','B05','B06','B07','B08','B09','B10','B11','B12','B13','B14','B15','B16','B17','B18','B19','B20'];
const results:Record<string,any>=Object.fromEntries(ids.map(id=>[id,{status:'BLOCKED',reason:'not executed'}]));
const observations:Record<string,unknown>={};
const locators={ai:'#ld-home-ai-box',avatar:'#ld-home-avatar-slot',profile:'form:has([name=nickname])',minimal:'input[name=minimal_mode], [data-action=toggle-minimal-mode]'};
async function requireVisible(p:Page,selector:string,reason:string) {try{await p.locator(selector).first().waitFor({state:'visible'});}catch{throw new Blocked(reason);}}
async function openProfile(p:Page) {
  await p.goto('/settings');await p.locator('#ld-main-region').waitFor();
  if(!await p.locator(locators.profile).count()) {
    const entry=p.locator('[data-subtab=profile]').first();
    if(!await entry.count())throw new Blocked('Gemini profile page/navigation is not implemented');
    await entry.click();
  }
  await requireVisible(p,locators.profile,'Profile form is unavailable');
}
async function saveProfile(p:Page) {await p.locator('#ld-profile-save-btn').click();}

// Browser tests run only against the synthetic test database using the test-only overlay.
test('Phase-one browser regression on phase-two integration',{timeout:180000},async t=>{
  guard();report('browser',results);const f=await fixture();let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;const contexts:BrowserContext[]=[];const errors:string[]=[];let cookies:Awaited<ReturnType<BrowserContext['cookies']>>=[];
  const scenario=async(id:string,run:(p:Page)=>Promise<void>)=>t.test(id,async()=>{
    const c=await browser!.newContext({baseURL:'http://gateway',viewport:{width:1280,height:900}});contexts.push(c);await c.addCookies(cookies);const p=await c.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));
    try{await p.goto('/');await p.locator('#ld-main-region').waitFor();await run(p);results[id]={status:'PASS'};}
    catch(e){results[id]={status:e instanceof Blocked?'BLOCKED':'FAIL',reason:(e as Error).message,observations:observations[id]};await p.screenshot({path:`${artifacts}/${id}.png`,fullPage:true}).catch(()=>{});throw e;}
    finally{report('browser',results);await c.close();}
  });
  try {
    const g=await graph(f);
    const field=profileField();await f.ok('PATCH','profile',{base_version:1,nickname:'浏览器合成用户',bio:'初始简介',field_upserts:[field]});
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
      await p.locator('#ld-form-record').waitFor({state:'detached'});
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
      await p.reload();await p.locator('#ld-main-region').waitFor();const recovery=p.locator('[data-action=resume-pending-config]').first();await recovery.waitFor();
      if(!await recovery.count())throw new Blocked('Reload recovery entry for frozen configuration operation is unavailable');
      await p.unrouteAll();await recovery.click();
      assert.equal(await p.locator('#ld-form-create-module [name=name]').inputValue(),name+'-当前草稿');
      const confirmation=p.waitForResponse(r=>r.url().endsWith('/api/v1/modules')&&r.request().method()==='POST');await p.locator('#ld-config-submit-btn').click();assert.equal((await confirmation).status(),200);
      assert.equal((await f.pool.query('SELECT count(*)::int n FROM modules WHERE name=$1',[name])).rows[0].n,1);
      await p.locator('[data-config-submission-status=confirmed_server]').waitFor();
      assert.equal(await p.locator('#ld-form-create-module [name=name]').inputValue(),name+'-当前草稿','Confirming frozen config must retain edited working draft');
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
      const adopt=p.locator('[data-action=profile-conflict-adopt]');await adopt.waitFor();assert.equal(sent[0].base_version,current.version);
      await adopt.click();const success=p.waitForResponse(r=>r.url().endsWith('/api/v1/profile')&&r.request().method()==='PATCH');await saveProfile(p);assert.equal((await success).status(),200);assert.equal(sent.at(-1).base_version,current.version+1);
    });
    await scenario('B05',async p=>{
      await openProfile(p);await p.locator(locators.profile+' [name=bio]').fill('尚未保存');
      const dialog=p.waitForEvent('dialog');const navigation=p.goto('/tasks').catch(()=>{});const d=await dialog;assert.equal(d.type(),'beforeunload');await d.dismiss();await navigation.catch(()=>{});assert.equal(await p.locator(locators.profile+' [name=bio]').inputValue(),'尚未保存');
    });
    await scenario('B06',async p=>{
      await p.goto('/settings');await p.locator('#ld-main-region').waitFor();
      if(!await p.locator(locators.minimal).count())await p.locator('[data-subtab=display]').click();
      await requireVisible(p,locators.minimal,'Persistent minimal-mode setting has not been implemented');
      const before=await f.ok('GET','home-preferences');const saved=p.waitForResponse(r=>r.url().endsWith('/api/v1/home-preferences')&&r.request().method()==='PATCH');await p.locator(locators.minimal).first().click();assert.equal((await saved).status(),200);await p.goto('/');await requireVisible(p,locators.ai,'Minimal mode AI container missing');await p.reload();
      const after=await f.ok('GET','home-preferences');assert.equal(after.minimal_mode,true);assert.deepEqual(after.pinned_metric_ids,before.pinned_metric_ids);assert.deepEqual(after.pinned_task_ids,before.pinned_task_ids);
      assert.equal(await p.locator(locators.avatar).count(),0);const box=await p.locator(locators.ai).first().boundingBox();assert.ok(box);const main=await p.locator('main').boundingBox();assert.ok(main);assert.ok(Math.abs(box.x+box.width/2-(main.x+main.width/2))<25,'AI container must be horizontally centered');
    });
    await scenario('B07',async p=>{
      const pref=await f.ok('GET','home-preferences');await f.ok('PATCH','home-preferences',{base_version:pref.version,minimal_mode:false});await p.reload();
      await requireVisible(p,locators.ai,'Homepage source cards are unavailable');
      await p.locator('[data-action=home-metric-detail]').first().click();assert.match(new URL(p.url()).pathname,/metrics/);assert.match(await p.locator('#ld-main-region').innerText(),/独立验收次数/);
      await p.goto('/');await p.locator('[data-action=home-task-detail]').first().click();assert.match(new URL(p.url()).pathname,/tasks/);
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

    await scenario('B11',async p=>{
      await openProfile(p);await p.locator('#ld-profile-bio-null').uncheck();const bio=p.locator('#ld-profile-bio');await bio.fill('资料原提交');
      const sent:any[]=[];await p.route('**/api/v1/profile',async route=>{if(route.request().method()!=='PATCH'){await route.continue();return;}sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});await route.fetch();await route.abort();});
      await saveProfile(p);await p.locator('[data-profile-submission-status=unknown_network], #ld-profile-status-bar[data-submission-status=unknown_network]').waitFor();
      await bio.fill('资料后续修改');await p.reload();await openProfile(p);assert.equal(await bio.inputValue(),'资料后续修改');await p.unrouteAll();
      await p.route('**/api/v1/profile',async route=>{if(route.request().method()==='PATCH')sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});await route.continue();});
      await saveProfile(p);await p.waitForFunction(()=>!Object.keys(JSON.parse(localStorage.getItem('life_dashboard_v0_1_pending_config_ops')??'{}')).length);
      assert.deepEqual(sent[1],sent[0]);assert.equal(await bio.inputValue(),'资料后续修改');assert.equal((await f.ok('GET','profile')).bio,'资料原提交');
      const confirmed=p.waitForResponse(r=>r.url().endsWith('/api/v1/profile')&&r.request().method()==='PATCH');await saveProfile(p);assert.equal((await confirmed).status(),200);assert.equal((await f.ok('GET','profile')).bio,'资料后续修改');
    });
    await scenario('B12',async p=>{
      await p.context().addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(/pending_config_ops/.test(k))throw new DOMException('synthetic failure','QuotaExceededError');return original.call(this,k,v);};});
      await p.reload();await p.locator('#ld-home-standard').waitFor();const before=await f.ok('GET','home-preferences'),sent:string[]=[];p.on('request',r=>{if(r.method()==='PATCH'&&r.url().endsWith('/home-preferences'))sent.push(r.url());});
      await p.locator('#ld-home-minimal-toggle-btn').click();await p.getByText('未保存本机',{exact:true}).first().waitFor();assert.deepEqual(sent,[]);assert.deepEqual(await f.ok('GET','home-preferences'),before);
    });
    const configCases=[
      {id:'B13',kind:'template',path:'record-types',route:'/settings',tab:'dependencies',form:'ld-form-create-template',action:'open-create-template',field:'name',table:'record_types'},
      {id:'B14',kind:'task',path:'tasks',route:'/tasks',form:'ld-form-create-task',action:'open-create-task',field:'title',table:'tasks'},
      {id:'B15',kind:'metric',path:'metrics',route:'/metrics',form:'ld-form-create-metric',action:'open-create-metric',field:'name',table:'metric_definitions'},
      {id:'B16',kind:'achievement',path:'achievements',route:'/achievements',form:'ld-form-create-achievement',action:'open-create-achievement',field:'name',table:'achievement_definitions'}
    ];
    for(const c of configCases)await scenario(c.id,async p=>{
      await p.goto(c.route);await p.locator('#ld-main-region').waitFor();if(c.tab)await p.locator(`[data-subtab=${c.tab}]`).click();await p.locator(`[data-action=${c.action}]`).first().click();
      const input=p.locator(`#${c.form} [name=${c.field}]`),value='配置可靠性-'+c.kind+'-'+randomUUID();await input.fill(value);
      if(c.kind==='task')await p.locator(`#${c.form} [name=completion_mode]`).selectOption('manual');
      if(c.kind==='metric')await p.locator('#ld-metric-agg-select').selectOption('count');
      const sent:any[]=[];await p.route('**/api/v1/'+c.path,async route=>{if(route.request().method()!=='POST'){await route.continue();return;}sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});const response=await route.fetch();assert.equal(response.status(),200,await response.text());await route.fulfill({status:200,contentType:'application/json',body:'broken-json'});});
      await p.locator('#ld-config-submit-btn').click();await p.locator('[data-config-submission-status=unknown_network]').waitFor();await input.fill(value+'-新草稿');await p.reload();
      await p.locator('#ld-main-region').waitFor();if(c.tab)await p.locator(`[data-subtab=${c.tab}]`).click();await p.locator(`[data-action=${c.action}]`).first().click();assert.equal(await input.inputValue(),value+'-新草稿');
      await p.unrouteAll();await p.route('**/api/v1/'+c.path,async route=>{if(route.request().method()==='POST')sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});await route.continue();});
      await p.locator('#ld-config-submit-btn').click();await p.locator('[data-config-submission-status=confirmed_server]').waitFor();assert.deepEqual(sent[1],sent[0]);assert.equal(await input.inputValue(),value+'-新草稿');assert.equal(await p.locator('#ld-config-submit-btn').isDisabled(),true);
      const rows=(await f.pool.query(`SELECT count(*)::int n FROM ${c.table} WHERE id=$1`,[sent[0].body.id])).rows;assert.equal(rows[0].n,1);
      await p.reload();await p.locator('#ld-main-region').waitFor();if(c.tab)await p.locator(`[data-subtab=${c.tab}]`).click();await p.locator(`[data-action=${c.action}]`).first().click();assert.equal(await input.inputValue(),value+'-新草稿');assert.equal(await p.locator('#ld-config-submit-btn').isDisabled(),true);
    });
    await scenario('B17',async p=>{
      const module=await f.ok('POST','modules',{id:randomUUID(),name:'归档资料验收',icon:'book',color:'blue'});const current=await f.ok('GET','profile');const archivedField=profileField(module.id);await f.ok('PATCH','profile',{base_version:current.version,field_upserts:[archivedField]});await f.ok('PATCH',`modules/${module.id}`,{base_version:1,status:'archived'});
      await openProfile(p);const row=p.locator(`[data-profile-field-row="${archivedField.id}"]`);assert.equal(await row.locator('[data-pf-prop=value]').isDisabled(),true);await p.locator('#ld-profile-bio-null').uncheck();await p.locator('#ld-profile-bio').fill('保留归档字段仍可保存简介');
      const saved=p.waitForResponse(r=>r.url().endsWith('/api/v1/profile')&&r.request().method()==='PATCH');await saveProfile(p);assert.equal((await saved).status(),200);const after=await f.ok('GET','profile');assert.equal(after.bio,'保留归档字段仍可保存简介');assert.deepEqual(after.module_fields.find((x:any)=>x.id===archivedField.id),archivedField);
    });
    await scenario('B18',async p=>{
      await p.setViewportSize({width:360,height:780});await p.reload();await p.locator('#ld-home-standard').waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'Mobile homepage must not overflow horizontally');await p.screenshot({path:`${artifacts}/mobile.png`,fullPage:true});
      await openProfile(p);await p.locator('#ld-profile-nickname').fill('手机合成昵称');const save=p.locator('#ld-profile-save-btn');await save.scrollIntoViewIfNeeded();const box=await save.boundingBox();assert.ok(box);assert.ok(box.x>=0&&box.x+box.width<=360);const response=p.waitForResponse(r=>r.url().endsWith('/api/v1/profile')&&r.request().method()==='PATCH');await save.click();assert.equal((await response).status(),200);
    });
    await scenario('B20',async p=>{
      const module=await f.ok('POST','modules',{id:randomUUID(),name:'真实表单七类型模块',icon:'book',color:'cyan'});await openProfile(p);
      const specs=[['text',null],['textarea','个人资料'],['integer',0],['decimal','0.001'],['date','2024-02-29'],['boolean',false],['single_select','第二']];
      for(let i=0;i<specs.length;i++){
        await p.locator('#ld-profile-add-module-select').selectOption(module.id);await p.locator('[data-action=profile-add-field]').click();const row=p.locator('[data-profile-field-row]').last();
        await row.locator('[data-pf-prop=key]').fill(i===0?'session':'ui_field_'+i);await row.locator('[data-pf-prop=label]').fill('实际字段'+i);await row.locator('[data-pf-prop=type]').selectOption(String(specs[i][0]));
        if(specs[i][0]==='single_select')await row.locator('[data-pf-prop=options]').fill('第一, 第二');
        if(specs[i][1]===null)await row.locator('[data-pf-prop=is_null]').check();else{await row.locator('[data-pf-prop=is_null]').uncheck();await row.locator('[data-pf-prop=value]').fill(String(specs[i][1]));}
      }
      const response=p.waitForResponse(r=>r.url().endsWith('/api/v1/profile')&&r.request().method()==='PATCH');await saveProfile(p);assert.equal((await response).status(),200);await p.locator('[data-profile-status=idle]').waitFor();
      const fields=(await f.ok('GET','profile')).module_fields.filter((x:any)=>x.module_id===module.id);assert.equal(fields.length,7);for(let i=0;i<specs.length;i++)assert.equal(fields.find((x:any)=>x.key===(i===0?'session':'ui_field_'+i)).value,specs[i][1]);
      const remove=fields.find((x:any)=>x.key==='ui_field_1');await p.locator(`[data-action=profile-remove-field][data-field-id="${remove.id}"]`).click();const removed=p.waitForResponse(r=>r.url().endsWith('/api/v1/profile')&&r.request().method()==='PATCH');await saveProfile(p);assert.equal((await removed).status(),200);assert.ok(!(await f.ok('GET','profile')).module_fields.some((x:any)=>x.id===remove.id));
    });
    await scenario('B19',async p=>{
      // Final scenario resets only the explicitly guarded synthetic DB.
      guard();await f.pool.query('TRUNCATE users CASCADE');await seed(f.pool);
      const login=await p.context().request.post('/api/v1/session',{headers:{Origin:'http://gateway'},data:{login_secret:process.env.LOCAL_LOGIN_SECRET}});assert.equal(login.status(),200);await p.goto('/');await p.locator('#ld-home-standard').waitFor();assert.equal(await p.locator('[data-home-metric-card]').count(),0);assert.equal(await p.locator('[data-home-task-card]').count(),0);assert.equal(await p.locator('[data-home-achievement-card]').count(),0);assert.match(await p.locator('main').innerText(),/未开放|未实现/);assert.equal((await f.pool.query('SELECT count(*)::int n FROM records')).rows[0].n,0);await p.screenshot({path:`${artifacts}/empty-home.png`,fullPage:true});
    });
    assert.deepEqual(errors,[],'Uncaught browser errors');
  } catch(e) {report('browser-infrastructure',{status:'FAIL',message:(e as Error).message});throw e;}
  finally{report('browser',results);report('browser-errors',errors);for(const c of contexts)await c.close().catch(()=>{});await browser?.close();await f.close();}
});
