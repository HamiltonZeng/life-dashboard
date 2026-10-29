import {fixture,module,field} from './fixtures.js';
import {randomUUID} from 'node:crypto';
const f=await fixture();try{const type=await f.ok('POST','record-types',{id:randomUUID(),module_id:module,name:'体重观测',fields:[field('weight','体重','decimal','kg')]});await f.ok('PATCH','profile',{base_version:1,field_upserts:[{id:randomUUID(),module_id:module,key:'weight',label:'体重',type:'decimal',kind:'observation',value:null,unit:'kg',options:[],binding:{record_type_id:type.id,field_key:'weight'}}]});}finally{await f.close();}
