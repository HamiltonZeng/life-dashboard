import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {DeepSeekAdapter} from '../../packages/ai/src/adapter.js';
import {buildGenerationPrompt} from '../../packages/ai/src/prompt.js';
import {loadAiConfig} from '../../packages/ai/src/config.js';
import {ALL_CONTENT} from './fixtures.js';
const context={mode:'create' as const,targetModuleId:null,targetModuleName:null,targetModuleIcon:null,targetModuleColor:null,timezone:'Asia/Shanghai',contentTypes:ALL_CONTENT,prompt:'测试',allowedRecordTypes:[],allowedMetrics:[]};
const input={...buildGenerationPrompt(context),context,maxOutputTokens:256,timeoutMs:25};
const envelope=JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
const adapter=(fetchImpl:typeof fetch)=>new DeepSeekAdapter({apiKey:'test-key-only',model:'test-model',baseUrl:'https://unit.test'},fetchImpl);
const slowBody=(status:number)=>new Response(new ReadableStream({async start(c){await delay(125);c.enqueue(new TextEncoder().encode(envelope));c.close();}}),{status});

test('R5: slow successful response body is bounded by the attempt deadline',async()=>{
  await assert.rejects(adapter((async()=>slowBody(200)) as typeof fetch).generate(input),{code:'AI_TIMEOUT'});
});
test('R5: slow error response body times out instead of delaying error parsing',async()=>{
  await assert.rejects(adapter((async()=>slowBody(401)) as typeof fetch).generate(input),{code:'AI_TIMEOUT'});
});
test('R5: delayed headers time out even if a transport ignores AbortSignal',async()=>{
  await assert.rejects(adapter((async()=>{await delay(125);return new Response(envelope);}) as typeof fetch).generate(input),{code:'AI_TIMEOUT'});
});
test('R5: a mid-body disconnect is a transport error, malformed JSON is output error',async()=>{
  const disconnected=new Response(new ReadableStream({start(c){c.error(new TypeError('connection reset'));}}));
  await assert.rejects(adapter((async()=>disconnected) as typeof fetch).generate(input),{code:'AI_UNAVAILABLE'});
  await assert.rejects(adapter((async()=>new Response('not-json')) as typeof fetch).generate(input),{code:'AI_INVALID_OUTPUT'});
});
test('S0: configuration distinguishes attempt timeout from model-run total deadline',()=>{
  const config=loadAiConfig({AI_TIMEOUT_MS:'10000',AI_MAX_ATTEMPTS:'3',AI_TASK_TIMEOUT_MS:'12000'}) as any;
  assert.equal(config.timeoutMs,10000);assert.equal(config.maxAttempts,3);assert.equal(config.taskTimeoutMs,12000);
});
