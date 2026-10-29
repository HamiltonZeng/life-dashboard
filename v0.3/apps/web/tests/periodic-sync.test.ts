import {test} from 'node:test';import assert from 'node:assert/strict';
import {PeriodicSync} from '../src/periodic-sync.js';import {ApiClientError} from '../src/api.js';
import {clearAllBrowserStorageForTest,getPendingConfigMutation} from '../src/storage.js';
import {submitPhase2Command} from '../src/phase2-submit.js';
test('periodic sync coalesces overlapping callers and wakes at server-relative boundary',async()=>{
 clearAllBrowserStorageForTest();let now=10,calls=0,refreshes=0;const states:string[]=[];const sync=new PeriodicSync({key:'test:coalesce',now:()=>now,state:s=>states.push(s),refresh:async()=>{refreshes++;},send:async()=>{calls++;return {instances:[],reused:[],server_time:'2030-01-01T00:00:00Z',next_check_at:'2030-01-01T00:00:01Z'};}});
 await Promise.all([sync.ensure(),sync.ensure(),sync.ensure()]);assert.equal(calls,1);await sync.ensure();assert.equal(calls,1);now=1010;await sync.ensure();assert.equal(calls,2);assert.equal(refreshes,2);assert.deepEqual(states,['syncing','ready','syncing','ready']);
});
test('unknown old-period receipt is acknowledged under its frozen key before a new current request',async()=>{
 clearAllBrowserStorageForTest();let first:string|undefined;await assert.rejects(submitPhase2Command('create-task-template','tab:old','materialize',{},async(_,key)=>{first=key;throw new ApiClientError(0,{code:'NETWORK_ERROR',message:'lost'});}));
 const keys:string[]=[];const sync=new PeriodicSync({key:'tab:old',state:()=>{},refresh:async()=>{},send:async(_,key)=>{keys.push(key);return {instances:[],reused:[]};}});await sync.ensure();assert.equal(keys.length,2);assert.equal(keys[0],first);assert.notEqual(keys[1],first);assert.equal(getPendingConfigMutation('tab:old'),null);
});
test('materialization failure remains visible, preserves pending and explicit retry succeeds',async()=>{
 clearAllBrowserStorageForTest();const states:string[]=[];let failed=true,gets=0;const sync=new PeriodicSync({key:'tab:error',state:s=>states.push(s),refresh:async()=>{gets++;},send:async()=>{if(failed)throw new ApiClientError(500,{code:'INTERNAL_ERROR',message:'synthetic'});return {instances:[],reused:[]};}});await assert.rejects(sync.ensure());assert.equal(gets,0);assert.ok(getPendingConfigMutation('tab:error'));failed=false;await sync.ensure(true);assert.equal(gets,1);assert.deepEqual(states,['syncing','error','syncing','ready']);
});
test('two tabs use distinct frozen envelopes and blocked session storage sends nothing',async()=>{
 clearAllBrowserStorageForTest();const previous=(globalThis as any).window;let sends=0;try{(globalThis as any).window={sessionStorage:{getItem(){throw Error('blocked');}}};const sync=new PeriodicSync({state:()=>{},refresh:async()=>{},send:async()=>{sends++;return {instances:[],reused:[]};}});await assert.rejects(sync.ensure(),(e:any)=>e.code==='LOCAL_STORAGE_FAILED');assert.equal(sends,0);}finally{if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
 const keys:string[]=[];await Promise.all(['tab:a','tab:b'].map(key=>new PeriodicSync({key,state:()=>{},refresh:async()=>{},send:async(_,op)=>{keys.push(op);return {instances:[],reused:[]};}}).ensure()));assert.equal(new Set(keys).size,2);
});
