import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPool} from '../packages/db/src/client.js';
import {migrate} from '../packages/db/src/migrate.js';
assert.equal(process.env.DATABASE_HOST,'postgres-test');assert.equal(process.env.DATABASE_NAME,'life_dashboard_v03_prephase1_restore');assert.equal(process.env.NODE_ENV,'test');
const pool=createPool();
try{
 const names=(await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'schema_migrations' ORDER BY table_name")).rows.map(r=>r.table_name);
 const columns=new Map<string,string[]>();for(const name of names)columns.set(name,(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[name])).rows.map(r=>r.column_name));
 const snapshot=async()=>{const out:Record<string,any>={};for(const name of names){const cols=columns.get(name)!.map(x=>'"'+x+'"').join(',');const rows=(await pool.query(`SELECT ${cols} FROM "${name}"`)).rows.map(r=>JSON.stringify(r)).sort();out[name]={count:rows.length,hash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return out;};
 const before=await snapshot(),old=(await pool.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;await migrate(pool);await migrate(pool);const after=await snapshot();assert.deepEqual(after,before);const current=(await pool.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;assert.deepEqual(current.slice(0,old.length),old);
 writeFileSync('.runtime/backups/pre-phase1/upgrade-proof.json',JSON.stringify({status:'PASS',source_migrations:old.length,target_migrations:current.length,original_tables_unchanged:after,source:'v0.3 pre-phase1 logical dump restored into isolated test PG',real_provider_called:false},null,2)+'\n');console.log('Restored v0.3 pre-phase1 database upgraded; all original table projections unchanged.');
}finally{await pool.end();}
