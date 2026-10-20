// Fresh candidate project only; never resets or connects the main/Codex databases.
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
assert.equal(process.env.FROZEN_ACCEPTANCE,'fresh-release-only');
assert.match(process.env.FROZEN_SHA??'',/^[a-f0-9]{40}$/);
const origin='http://localhost:18184';
// The browser container has its own localhost. Forward transparently to the candidate's Caddy,
// preserving the configured page Origin and all headers rather than bypassing CSRF validation.
const proxy=createServer((req,res)=>{const upstream=request({hostname:'gateway',port:80,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode!,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});
await new Promise<void>(resolve=>proxy.listen(18184,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const ctx=await browser.newContext({baseURL:origin,viewport:{width:1280,height:900}});
try{
 const secret=readFileSync('.secrets/development.env','utf8').match(/^LOCAL_LOGIN_SECRET=(.+)$/m)![1];
 const p=await ctx.newPage(),errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 let command:{body:any;key:string}|undefined;p.on('request',r=>{if(r.method()==='POST'&&r.url()===origin+'/api/v1/records')command={body:r.postDataJSON(),key:r.headers()['idempotency-key']};});
 await p.goto('/');await p.locator('[name=login_secret]').fill(secret);await p.locator('#ld-login-form button[type=submit]').click();await p.locator('#ld-main-region').waitFor();
 const get=async(path:string)=>{const r=await ctx.request.get('/api/v1/'+path);assert.equal(r.status(),200,await r.text());return (await r.json()).data;};
 assert.equal((await get('capabilities')).app_version,'0.2.0-rc.1');assert.equal((await get('records')).length,0);
 await p.goto('/records');await p.locator('[data-action=open-create-record]').click();await p.locator('[data-field-key=topic]').fill('frozen checkout synthetic record');await p.locator('#ld-form-record button[type=submit]').click();await p.locator('#ld-form-record').waitFor({state:'detached'});
 const records=await get('records');assert.equal(records.length,1);assert.equal(records[0].values.topic,'frozen checkout synthetic record');assert.ok(command);
 const before=await get('export');const replay=await ctx.request.post('/api/v1/records',{headers:{Origin:origin,'Idempotency-Key':command.key},data:command.body});assert.equal(replay.status(),200,await replay.text());assert.deepEqual((await get('export')).data,before.data);
 await p.reload();await p.locator('#ld-main-region').waitFor();assert.equal((await get('records')).length,1);
 await p.setViewportSize({width:360,height:800});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.deepEqual(errors,[]);
 mkdirSync('.runtime/test-artifacts/frozen',{recursive:true});writeFileSync('.runtime/test-artifacts/frozen/browser.json',JSON.stringify({status:'PASS',sha:process.env.FROZEN_SHA,browser:browser.version(),login_ui:true,record_ui:true,exact_replay:true,one_record_after_reload:true,viewport_360:true,real_device:false,uncaught_errors:errors},null,2));console.log('frozen candidate login, record, exact replay and reload PASS');
}finally{await ctx.close();await browser.close();await new Promise<void>((resolve,reject)=>proxy.close(e=>e?reject(e):resolve()));}
