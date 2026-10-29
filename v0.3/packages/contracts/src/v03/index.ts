import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
const require=createRequire(import.meta.url);
const fastifyRequire=createRequire(require.resolve('fastify/package.json'));
const compilerRequire=createRequire(fastifyRequire.resolve('@fastify/ajv-compiler/package.json'));
const Ajv=compilerRequire('ajv/dist/2020.js').default;
const ajv=new Ajv({strict:true,allErrors:true});compilerRequire('ajv-formats')(ajv);
const read=(name:string)=>JSON.parse(readFileSync(new URL(`../../v03/${name}.schema.json`,import.meta.url),'utf8'));
export const decisionSchema=read('ai-decision');
export const publicSchema=read('public-api');
ajv.addSchema(read('report-facts'));ajv.addSchema(read('report-narrative'));ajv.addSchema(publicSchema);ajv.addSchema(decisionSchema);
export const PHASE1_ACTIONS=['goal.create','record_type.create','metric.create','task_template.create','achievement_series.create'] as const;
export type EntityRef={kind:'existing';id:string}|{kind:'local';local_ref:string};
export interface Action {action_type:string;local_ref:string;depends_on:string[];evidence_refs:string[];data:Record<string,any>}
export interface Decision {schema_version:'ai-decision/1.0';context_ref:string;intent:string;summary:string;assumptions:{text:string;kind:string}[];clarification:null|{question:string;choices:string[];blocking_fields:string[]};actions:Action[]}
const validators=new Map<string,any>();
export function parseDto<T=any>(name:string,value:unknown):T {
 let validate=validators.get(name);
 if(!validate){validate=ajv.compile({$ref:publicSchema.$id+'#/$defs/'+name});validators.set(name,validate);}
 if(!validate(value))throw new z.ZodError([{code:'custom',path:[],message:`Invalid ${name}: `+ajv.errorsText(validate.errors)}]);
 return value as T;
}
export function parseDecision(value:unknown):Decision {
 const validate=ajv.getSchema(decisionSchema.$id);
 if(!validate(value))throw new z.ZodError([{code:'custom',path:[],message:'Invalid decision: '+ajv.errorsText(validate.errors)}]);
 return value as Decision;
}
export const pageInput=z.strictObject({limit:z.coerce.number().int().min(1).max(100).default(30),offset:z.coerce.number().int().min(0).max(100000).default(0)});

export function schemaFor(name:string){return read(name);}
export function parseSchema<T=any>(name:string,value:unknown):T{const key='schema:'+name;let validate=validators.get(key);if(!validate){const schema=read(name);validate=ajv.getSchema(schema.$id)??ajv.compile(schema);validators.set(key,validate);}if(!validate(value))throw new z.ZodError([{code:'custom',path:[],message:ajv.errorsText(validate.errors)}]);return value as T;}
