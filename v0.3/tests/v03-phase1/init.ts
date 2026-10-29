import {guardSynthetic} from '../v02-phase3/guard.js';
import {createPool} from '../../packages/db/src/client.js';
import {migrate} from '../../packages/db/src/migrate.js';
import {seed} from '../../packages/db/src/seed.js';
guardSynthetic();const pool=createPool();try{await migrate(pool);await pool.query('TRUNCATE users CASCADE');await seed(pool);}finally{await pool.end();}
