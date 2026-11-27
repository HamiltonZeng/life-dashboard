import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { buildApp } from '../../apps/api/src/app.js';
import { LocalDeepSeekCredentials } from '../../apps/api/src/ai/local-credentials.js';
import { PlanningService } from '../../apps/api/src/ai/service.js';
import { DeepSeekGateway } from '../../packages/ai/src/v03/gateway.js';
import { createPool } from '../../packages/db/src/client.js';
import { migrate } from '../../packages/db/src/migrate.js';
import { seed } from '../../packages/db/src/seed.js';
import { guardSynthetic } from '../v02-phase3/guard.js';

test('local DeepSeek credential is write-only, encrypted, and applied live in another planning instance', async () => {
  guardSynthetic();
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-credential-test-'));
  const master = join(dir, 'master-key');
  writeFileSync(master, randomBytes(32), { mode: 0o600 });
  const store = new LocalDeepSeekCredentials(master, join(dir, 'vault'));
  const pool = createPool();
  const origin = 'http://localhost:18380';
  const loginSecret = 'test-login-secret-for-credential-only';
  const key = 'sk-synthetic-credential-not-a-real-key';
  const worker = new PlanningService(pool, { origin, localCredentials: store });
  const app = await buildApp(pool, { profile:'mvp', origin, loginSecret, planning:worker });
  const external = await buildApp(pool, { profile:'mvp', origin:'https://example.test', loginSecret });
  try {
    await migrate(pool);
    await seed(pool);
    const login=await app.inject({method:'POST',url:'/api/v1/session',headers:{origin},payload:{login_secret:loginSecret}});
    assert.equal(login.statusCode,200);
    const cookie=String(login.headers['set-cookie']).split(';')[0];
    const url='/api/v1/ai/credential';
    const send=(action:'save'|'remove', password=loginSecret, hostOrigin=origin, session=cookie)=>
      app.inject({method:'POST',url,headers:{origin:hostOrigin,cookie:session},payload:{action,login_secret:password,...(action==='save'?{api_key:key}:{})}});
    assert.equal((await send('save',loginSecret,origin,'')).statusCode,401);
    assert.equal((await send('save',loginSecret,'https://example.test')).statusCode,403);
    assert.equal((await send('save','incorrect-password')).statusCode,401);
    const denied=await external.inject({method:'POST',url,headers:{origin:'https://example.test',cookie},payload:{action:'save',login_secret:loginSecret,api_key:key}});
    assert.equal(denied.statusCode,403);
    assert.equal(store.read(),undefined);

    const receiptCount = async () => (await pool.query('SELECT count(*) FROM mutation_receipts')).rows[0].count;
    const before = await receiptCount();
    const saved=await send('save');
    assert.equal(saved.statusCode,200);
    assert.equal(saved.headers['cache-control'],'no-store');
    assert.deepEqual(saved.json(),{data:{saved:true}});
    const path=join(dir,'vault','deepseek-v1.enc');
    const sealed=readFileSync(path);
    assert.equal(statSync(path).mode&0o777,0o600);
    assert.equal(statSync(join(dir,'vault')).mode&0o777,0o700);
    assert.equal(sealed.includes(key),false);
    assert.equal(store.read(),key);

    const config=await app.inject({url:'/api/v1/ai/config',headers:{cookie}});
    assert.equal(config.json().data.configured,true);
    assert.equal(config.json().data.base_url,'https://api.deepseek.com');
    assert.equal(config.body.includes(key),false);
    const backup=await app.inject({url:'/api/v1/export',headers:{cookie}});
    assert.equal(backup.statusCode,200);
    assert.equal(backup.body.includes(key),false);

    const otherProcess = new PlanningService(pool, { origin, localCredentials: new LocalDeepSeekCredentials(master, join(dir,'vault')) });
    let calls=0;
    const gateway=new DeepSeekGateway(()=>otherProcess.config,async(target,options)=>{
      calls++;
      assert.equal(target,'https://api.deepseek.com/chat/completions');
      assert.equal(options?.redirect,'error');
      assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer '+key);
      assert.equal(String(options?.body).includes(key),false);
      return new Response(JSON.stringify({choices:[{message:{content:'{}'}}]}));
    });
    await gateway.generate({instructions:'test',input:{}},new AbortController().signal);
    const updated=await send('save');
    assert.equal(updated.statusCode,200);
    assert.notDeepEqual(readFileSync(path),sealed); // A fresh nonce is used on every replacement.
    const removed=await send('remove');
    assert.deepEqual(removed.json(),{data:{saved:false}});
    await assert.rejects(gateway.generate({},new AbortController().signal),{code:'AI_NOT_CONFIGURED'});
    assert.equal(calls,1);
    assert.equal(await receiptCount(),before);
  } finally {
    await external.close();
    await app.close();
    await pool.end();
    rmSync(dir,{recursive:true,force:true});
  }
});
