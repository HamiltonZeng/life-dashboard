import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DomainError} from '../../packages/domain/src/index.js';
import {DeepSeekGateway,gatewayConfig,type GatewayConfig} from '../../packages/ai/src/v03/gateway.js';
const config:GatewayConfig={...gatewayConfig({}),enabled:true,configured:true,apiKey:'never-print-this-key',model:'configured-model',thinking:null,reasoningEffort:null};
const call=(fetcher:any,cfg:GatewayConfig=config)=>new DeepSeekGateway(cfg,fetcher).generate({instructions:'Return JSON',input:{message:'synthetic'}},new AbortController().signal);
test('P1-A13 provider statuses, malformed/empty/truncated JSON and usage',async t=>{
 for(const [status,code]of [[400,'AI_BAD_REQUEST'],[422,'AI_BAD_REQUEST'],[401,'AI_AUTH'],[402,'AI_QUOTA'],[429,'AI_RATE_LIMIT'],[503,'AI_UNAVAILABLE']] as const)await t.test(String(status),async()=>{await assert.rejects(call(async()=>new Response('secret must not leak',{status})),(e:any)=>e.code===code&&!e.message.includes('secret'));});
 for(const [body,code]of [[{choices:[{finish_reason:'length',message:{content:'{}'}}]},'AI_OUTPUT_TRUNCATED'],[{choices:[{message:{content:''}}]},'AI_INVALID_OUTPUT'],[{choices:[{message:{content:'not JSON'}}]},'AI_INVALID_OUTPUT']] as const)await t.test(code,async()=>{await assert.rejects(call(async()=>Response.json(body)),(e:any)=>e.code===code);});
 const result=await call(async(_url:any,options:any)=>{const input=JSON.parse(options.body);assert.equal(input.model,'configured-model');assert.equal(input.stream,false);assert.equal(input.temperature,0.2);assert.deepEqual(input.response_format,{type:'json_object'});return Response.json({model:'actual-model-version',choices:[{message:{content:'{}'}}],usage:{prompt_tokens:120,completion_tokens:10}});});assert.deepEqual(result.usage,{input:120,output:10});assert.equal(result.model,'actual-model-version');
 const unknown=await call(async()=>Response.json({choices:[{message:{content:'{}'}}]}));assert.equal(unknown.usage,null);
 const controller=new AbortController();controller.abort();await assert.rejects(new DeepSeekGateway(config,async()=>{throw new Error('raw credential error');}).generate({},controller.signal),(e:any)=>e.code==='AI_TIMEOUT'&&!e.message.includes('credential'));
 await assert.rejects(new DeepSeekGateway(gatewayConfig({})).generate({},new AbortController().signal),(e:any)=>e.code==='AI_NOT_CONFIGURED');
 assert.throws(()=>gatewayConfig({V03_AI_DAILY_JOBS:'Infinity'}));
});

test('R1 gatewayConfig defaults, trimming, validation and deepseek-flash thinking payload',async()=>{
 const defaults=gatewayConfig({V03_AI_ENABLED:'1',DEEPSEEK_API_KEY:' sk-test-key ',DEEPSEEK_BASE_URL:'   ',V03_AI_MAX_INPUT_TOKENS:'  '});
 assert.equal(defaults.apiKey,'sk-test-key');
 assert.equal(defaults.model,'deepseek-flash');
 assert.equal(defaults.baseUrl,'https://api.deepseek.com');
 assert.equal(defaults.thinking,'enabled');
 assert.equal(defaults.reasoningEffort,'high');
 assert.equal(defaults.rewardPricing,true);
 assert.equal(defaults.dailyJobs,30);
 assert.equal(defaults.dailyInput,1000000);
 assert.equal(defaults.dailyOutput,200000);
 assert.equal(defaults.maxInput,100000);
 assert.equal(defaults.maxOutput,12000);
 assert.equal(defaults.attemptMs,90000);
 assert.equal(defaults.runMs,240000);
 assert.equal(gatewayConfig({DEEPSEEK_BASE_URL:'not-a-url'}).enabled,false);
 assert.throws(()=>gatewayConfig({V03_AI_ENABLED:'1',DEEPSEEK_BASE_URL:'http://api.deepseek.com'}));
 assert.throws(()=>gatewayConfig({V03_AI_ENABLED:'1',DEEPSEEK_BASE_URL:'https://user:pass@api.deepseek.com'}));
 assert.throws(()=>gatewayConfig({V03_AI_THINKING:'auto'}));
 assert.throws(()=>gatewayConfig({V03_AI_REASONING_EFFORT:'ultra'}));
 assert.throws(()=>gatewayConfig({V03_AI_TEMPERATURE:'2.5'}));

 const flashResult=await call(async(url:any,options:any)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');
  const payload=JSON.parse(options.body);
  assert.equal(payload.model,'deepseek-flash');
  assert.equal(payload.stream,false);
  assert.deepEqual(payload.thinking,{type:'enabled'});
  assert.equal(payload.reasoning_effort,'high');
  assert.equal('temperature' in payload,false);
  return Response.json({choices:[{message:{content:'```json\r\n{"ok":true}\r\n```'}}]});
 },defaults);
 assert.deepEqual(flashResult.value,{ok:true});

 const disabledThinking=gatewayConfig({V03_AI_ENABLED:'1',DEEPSEEK_API_KEY:'sk-test-key',V03_AI_THINKING:'disabled',V03_AI_TEMPERATURE:'0.5'});
 assert.equal(disabledThinking.thinking,'disabled');
 assert.equal(disabledThinking.reasoningEffort,null);
 const plainResult=await call(async(_url:any,options:any)=>{
  const payload=JSON.parse(options.body);
  assert.deepEqual(payload.thinking,{type:'disabled'});
  assert.equal(payload.temperature,0.5);
  assert.equal('reasoning_effort' in payload,false);
  return Response.json({choices:[{message:{content:'```\n{"plain":1}\n```'}}]});
 },disabledThinking);
 assert.deepEqual(plainResult.value,{plain:1});
});

test('R1 gateway body read abort cancels stream with AI_TIMEOUT and mid-stream error throws AI_UNAVAILABLE',async()=>{
 let errCancelled=false;
 const errBody=new ReadableStream({
  start(c){c.enqueue(new TextEncoder().encode('secret'));},
  cancel(){errCancelled=true;}
 });
 await assert.rejects(call(async()=>new Response(errBody,{status:400})),(e:any)=>e instanceof DomainError&&e.code==='AI_BAD_REQUEST');
 assert.equal(errCancelled,true);

 const abort=new AbortController();
 const slowBody=new ReadableStream({
  start(c){
   const t=setTimeout(()=>{try{c.enqueue(new TextEncoder().encode('{}'));c.close();}catch{}},500);
   abort.signal.addEventListener('abort',()=>clearTimeout(t),{once:true});
  }
 });
 const started=Date.now();
 const abortCall=new DeepSeekGateway(config,async()=>new Response(slowBody,{status:200})).generate({instructions:'Return JSON',input:{}},abort.signal);
 setTimeout(()=>abort.abort(),20);
 await assert.rejects(abortCall,(e:any)=>e instanceof DomainError&&e.code==='AI_TIMEOUT'&&!e.message.includes(config.apiKey));
 assert.ok(Date.now()-started<300);

 const brokenBody=new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode('{"partial":'));controller.error(new Error('stream reset with sk-secret123'));}
 });
 await assert.rejects(call(async()=>new Response(brokenBody,{status:200})),(e:any)=>e instanceof DomainError&&e.code==='AI_UNAVAILABLE'&&!e.message.includes('sk-secret123'));
});

test('R1 gateway normalizes multi-slash baseUrl and rejects null/primitive HTTP 200 envelopes with AI_INVALID_OUTPUT',async()=>{
 const multiSlashCfg=gatewayConfig({V03_AI_ENABLED:'1',DEEPSEEK_API_KEY:'sk-test-key',DEEPSEEK_BASE_URL:'https://api.deepseek.com///'});
 const seenUrls:string[]=[];
 const res=await call(async(url:any)=>{
  seenUrls.push(String(url));
  return Response.json({choices:[{message:{content:'{"ok":true}'}}]});
 },multiSlashCfg);
 assert.deepEqual(res.value,{ok:true});
 assert.equal(seenUrls[0],'https://api.deepseek.com/chat/completions');

 for(const raw of ['null','123','true','"string-envelope"']){
  await assert.rejects(
   call(async()=>new Response(raw,{status:200}),multiSlashCfg),
   (e:any)=>e instanceof DomainError&&e.code==='AI_INVALID_OUTPUT'&&e.status===422
  );
 }
});
