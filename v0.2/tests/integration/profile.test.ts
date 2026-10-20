import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {buildApp} from '../../apps/api/src/app.js';
import {createPool} from '../../packages/db/src/client.js';
import {seed,LOCAL_USER_ID,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from '../../packages/db/src/seed.js';
test('MVP profile rejects AI before provider setup and keeps manual data usable',async()=>{
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DATABASE_HOST,'postgres-test');assert.equal(process.env.DATABASE_NAME,'life_dashboard_test');
  const pool=createPool();await pool.query('TRUNCATE users CASCADE');await seed(pool);
  const savedUrl=process.env.DEEPSEEK_BASE_URL;process.env.DEEPSEEK_BASE_URL='bad-url-would-break-development';
  let calls=0;
  const app=await buildApp(pool,{profile:'mvp',aiAdapter:{provider:'deepseek',model:'unused',cloud:true,async generate(){calls++;throw Error('must never call');}}});
  if(savedUrl===undefined)delete process.env.DEEPSEEK_BASE_URL;else process.env.DEEPSEEK_BASE_URL=savedUrl;
  try {
    const token='c'.repeat(64),cookie='life_session='+token;
    await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),LOCAL_USER_ID]);
    const req=(method:string,path:string,payload?:any)=>app.inject({method:method as any,url:'/api/v1/'+path,headers:{cookie,origin:'http://localhost:18080','idempotency-key':randomUUID()},payload});
    const caps=(await req('GET','capabilities')).json().data;
    assert.equal(caps.profile,'mvp');for(const key of ['ai_generation','ai_preview','cloud_ai','sync','professional_ledger'])assert.equal(caps[key],false);
    assert.equal((await req('GET','ai/config')).json().data.enabled,false);
    const id=randomUUID();
    for(const path of ['ai/generations',`ai/generations/${id}/apply`,`ai/generations/${id}/retry`,`ai/generations/${id}/cancel`,`ai/batches/${id}/revoke`]) {
      const r=await req('POST',path,{unexpected:'disabled before payload parsing'});assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error.code,'FEATURE_DISABLED');
    }
    for(const path of ['ai/generations','ai/batches',`ai/generations/${id}`,`ai/batches/${id}`])assert.equal((await req('GET',path)).statusCode,409);
    assert.equal(calls,0);assert.equal((await pool.query('SELECT count(*)::int n FROM ai_generation_jobs')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int n FROM ai_generation_batches')).rows[0].n,0);
    const record=await req('POST','records',{id:randomUUID(),module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],schema_version:1,occurred_at:new Date().toISOString(),timezone:'Asia/Shanghai',status:'confirmed',values:{topic:'isolated MVP fixture'},task_ids:[]});assert.equal(record.statusCode,200,record.body);
    assert.equal((await req('GET','bootstrap')).json().data.records.length,1);
    assert.equal((await req('GET','export')).statusCode,200);
  } finally {await app.close();await pool.end();}
});
