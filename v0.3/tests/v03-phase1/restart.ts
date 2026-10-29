import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {message} from './fixtures.js';
const base='http://gateway-test/api/v1/',origin='http://gateway-test';
const login=await fetch(base+'session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login_secret:process.env.LOCAL_LOGIN_SECRET})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
const req=async(path:string,body?:any,key=randomUUID())=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return (await r.json()).data;};
const path='.runtime/test-artifacts/v03-phase1/restart-state.json';
try{
 if(process.argv[2]==='prepare'){
  const conv=await req('ai/conversations',{entrypoint:'home',title:null}),body=message(),op=randomUUID(),accepted=await req(`ai/conversations/${conv.id}/messages`,body,op);assert.equal(accepted.status,'queued');
  const count=(await req('records')).length;writeFileSync(path,JSON.stringify({conv:conv.id,body,op,run:accepted.run_id,count}));console.log('Queued durable run before API/worker restart.');
 }else{
  const state=JSON.parse(readFileSync(path,'utf8'));let turn:any;
  for(let n=0;n<60;n++){turn=await req('ai/runs/'+state.run);if(['completed','failed'].includes(turn.status))break;await new Promise(r=>setTimeout(r,500));}
  assert.equal(turn.status,'completed',JSON.stringify(turn));assert.ok(turn.application);
  const replay=await req(`ai/conversations/${state.conv}/messages`,state.body,state.op);assert.equal(replay.run_id,state.run);assert.equal((await req('records')).length,state.count);
  writeFileSync('.runtime/test-artifacts/v03-phase1/restart.json',JSON.stringify({status:'PASS',actual_api_worker_restart:true,stable_run:true,application:turn.application.application_id,no_duplicate_facts:true},null,2)+'\n');console.log('API/worker restart recovery and original-key replay PASS');
 }
}finally{await fetch(base+'session',{method:'DELETE',headers:{Cookie:cookie,Origin:origin}});}
