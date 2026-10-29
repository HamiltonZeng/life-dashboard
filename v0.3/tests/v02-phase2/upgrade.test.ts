import {test} from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {randomUUID} from 'node:crypto';
import {guard,LOCAL_USER_ID,DEFAULT_MODULE_IDS} from './support.js';import {createPool} from '../../packages/db/src/client.js';import {migrate} from '../../packages/db/src/migrate.js';import {Service} from '../../apps/api/src/service.js';
test('old-code empty restore followed by additive upgrade preserves identities and receipts without historical rewards',async()=>{
 guard();const admin=createPool(),schema='phase2_upgrade_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({host:process.env.DATABASE_HOST,database:process.env.DATABASE_NAME,user:process.env.DATABASE_USER,password:process.env.POSTGRES_PASSWORD,options:`-c search_path=${schema}`});
 try{
 const root=new URL('../../.runtime/phase1-upgrade/v0.2/',import.meta.url);
 const oldMigrate=await import(new URL('packages/db/src/migrate.ts',root).href),oldBackup=await import(new URL('packages/db/src/backup.ts',root).href),oldSeed=await import(new URL('packages/db/src/seed.ts',root).href);
 await oldMigrate.migrate(pool);await oldSeed.seed(pool);
 // Create the fixture with the original source's service and original mutation receipt format.
 const OldService=(await import(new URL('apps/api/src/service.ts',root).href)).Service,old=new OldService(pool),task=randomUUID(),key=randomUUID();
 const body={id:task,module_id:DEFAULT_MODULE_IDS[0],title:'synthetic old task',completion_mode:'manual',record_type_id:null,acceptance:null,timezone:'Asia/Shanghai'};
 const original=await old.mutate(LOCAL_USER_ID,key,'POST','tasks',body);
 const backup=await oldBackup.exportUserData(pool,LOCAL_USER_ID);assert.equal(backup.migrations.length,3);
 await pool.query('TRUNCATE users CASCADE');await oldBackup.restoreUserData(pool,backup);
 assert.deepEqual((await oldBackup.exportUserData(pool,LOCAL_USER_ID)).data,backup.data);
 await migrate(pool);assert.equal((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'7');
 const service=new Service(pool);assert.deepEqual(await service.mutate(LOCAL_USER_ID,key,'POST','tasks',body),JSON.parse(JSON.stringify(original)));
 await service.mutate(LOCAL_USER_ID,randomUUID(),'POST',`tasks/${task}/complete`,{base_version:1});
 assert.equal((await pool.query('SELECT count(*) FROM wallet_ledger')).rows[0].count,'0');assert.equal((await pool.query('SELECT count(*) FROM reward_qualifications')).rows[0].count,'0');
 assert.equal((await pool.query('SELECT id FROM tasks WHERE id=$1',[task])).rows[0].id,task);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
