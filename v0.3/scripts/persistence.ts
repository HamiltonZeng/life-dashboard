import {guardSynthetic} from '../tests/v02-phase3/guard.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {createPool} from '../packages/db/src/client.js';
import {migrate} from '../packages/db/src/migrate.js';
import {seed,LOCAL_USER_ID,DEFAULT_MODULE_IDS,DEFAULT_TEMPLATE_IDS} from '../packages/db/src/seed.js';
import {Service} from '../apps/api/src/service.js';
guardSynthetic();
const admin=createPool();
const db='life_dashboard_v03_persistence_test';
const state='.runtime/test-artifacts/persistence.json';
const mode=process.argv[2];
try {
  if(mode==='prepare') {
    // A separate, explicitly named fixture database; never write a test fact to the user's database.
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rows.length,0,'Probe DB already exists: inspect before retrying');
    await admin.query('CREATE DATABASE '+db);
  }
  process.env.DATABASE_NAME=db;
  const pool=createPool();
  try {
    if(mode==='prepare') {
      await migrate(pool);await seed(pool);
      const id=randomUUID();
      await new Service(pool).mutate(LOCAL_USER_ID,randomUUID(),'POST','records',{id,module_id:DEFAULT_MODULE_IDS[0],record_type_id:DEFAULT_TEMPLATE_IDS[0],schema_version:1,occurred_at:new Date().toISOString(),timezone:'Asia/Shanghai',status:'confirmed',values:{topic:'隔离数据库持久化验收夹具',duration_minutes:5},task_ids:[]});
      await writeFile(state,JSON.stringify({id,database:db}));
      console.log('Persistence fixture committed in isolated database. Recreate postgres before verify.');
    } else if(mode==='verify') {
      const {id,database}=JSON.parse(await readFile(state,'utf8'));assert.equal(database,db);
      const row=(await pool.query('SELECT values,version FROM records WHERE id=$1',[id])).rows[0];
      assert.equal(row.values.duration_minutes,5);assert.equal(row.version,1);
      console.log('PASS: committed record survived PostgreSQL container recreation.');
    } else throw new Error('Expected prepare or verify');
  } finally {await pool.end();}
  if(mode==='verify') await admin.query('DROP DATABASE '+db);
} finally {await admin.end();}
