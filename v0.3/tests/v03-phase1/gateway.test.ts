import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DeepSeekGateway,gatewayConfig} from '../../packages/ai/src/v03/gateway.js';
const config={...gatewayConfig({}),enabled:true,configured:true,apiKey:'never-print-this-key',model:'configured-model'};
const call=(fetcher:any)=>new DeepSeekGateway(config,fetcher).generate({instructions:'Return JSON',input:{message:'synthetic'}},new AbortController().signal);
test('P1-A13 provider statuses, malformed/empty/truncated JSON and usage',async t=>{
 for(const [status,code]of [[401,'AI_AUTH'],[402,'AI_QUOTA'],[429,'AI_RATE_LIMIT'],[503,'AI_UNAVAILABLE']] as const)await t.test(String(status),async()=>{await assert.rejects(call(async()=>new Response('secret must not leak',{status})),(e:any)=>e.code===code&&!e.message.includes('secret'));});
 for(const [body,code]of [[{choices:[{finish_reason:'length',message:{content:'{}'}}]},'AI_OUTPUT_TRUNCATED'],[{choices:[{message:{content:''}}]},'AI_INVALID_OUTPUT'],[{choices:[{message:{content:'not JSON'}}]},'AI_INVALID_OUTPUT']] as const)await t.test(code,async()=>{await assert.rejects(call(async()=>Response.json(body)),(e:any)=>e.code===code);});
 const result=await call(async(_url:any,options:any)=>{const input=JSON.parse(options.body);assert.equal(input.model,'configured-model');assert.deepEqual(input.response_format,{type:'json_object'});return Response.json({model:'actual-model-version',choices:[{message:{content:'{}'}}],usage:{prompt_tokens:120,completion_tokens:10}});});assert.deepEqual(result.usage,{input:120,output:10});assert.equal(result.model,'actual-model-version');
 const unknown=await call(async()=>Response.json({choices:[{message:{content:'{}'}}]}));assert.equal(unknown.usage,null);
 const controller=new AbortController();controller.abort();await assert.rejects(new DeepSeekGateway(config,async()=>{throw new Error('raw credential error');}).generate({},controller.signal),(e:any)=>e.code==='AI_TIMEOUT'&&!e.message.includes('credential'));
 await assert.rejects(new DeepSeekGateway(gatewayConfig({})).generate({},new AbortController().signal),(e:any)=>e.code==='AI_NOT_CONFIGURED');
 assert.throws(()=>gatewayConfig({V03_AI_DAILY_JOBS:'Infinity'}));
});
