import { createPool } from './client.js';
import type pg from 'pg';
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_MODULE_IDS = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004'];
export const DEFAULT_TEMPLATE_IDS = ['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
export async function seed(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(11201802)");
    await c.query("INSERT INTO users(id,name) VALUES($1,'本地用户') ON CONFLICT DO NOTHING", [LOCAL_USER_ID]);
    await c.query('INSERT INTO user_sync_clock(user_id) VALUES($1) ON CONFLICT DO NOTHING', [LOCAL_USER_ID]);
    const names = ['学习与发展','饮食与锻炼','财富与收获','娱乐和交际'];
    const templates = ['学习记录','运动随记','收获随记','活动记录'];
    const icons = ['book','dumbbell','wallet','sparkles'], colors = ['blue','green','amber','violet'];
    for (let i=0; i<4; i++) {
      await c.query("INSERT INTO modules(id,user_id,name,icon,color,sort_order,source) VALUES($1,$2,$3,$4,$5,$6,'builtin') ON CONFLICT DO NOTHING", [DEFAULT_MODULE_IDS[i], LOCAL_USER_ID,names[i],icons[i],colors[i],i]);
      const fields = [{key:'topic',label:'实际内容',type:'text',required:true,unit:null,options:[],minimum:null,maximum:null},
        ...(i===0 ? [{key:'duration_minutes',label:'实际分钟数',type:'integer',required:false,unit:'分钟',options:[],minimum:0,maximum:1440}] : [])];
      await c.query('INSERT INTO record_types(id,user_id,module_id,name,fields) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [DEFAULT_TEMPLATE_IDS[i],LOCAL_USER_ID,DEFAULT_MODULE_IDS[i],templates[i],JSON.stringify(fields)]);
    }
    await c.query('COMMIT');
  } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
}
if (process.argv[1]?.endsWith('/seed.ts')) { const pool=createPool(); try {await seed(pool); console.log('Default configuration installed; no factual records, tasks or awards created.');} finally {await pool.end();} }
