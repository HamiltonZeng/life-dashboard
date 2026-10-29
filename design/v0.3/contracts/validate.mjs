// Design-only checks. Uses existing Fastify's Ajv dependencies; no network, database or model calls.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const projectRequire=createRequire(process.env.DESIGN_PROJECT_PACKAGE??'/workspace/package.json');
const fastifyRequire=createRequire(projectRequire.resolve('fastify/package.json'));
const compilerRequire=createRequire(fastifyRequire.resolve('@fastify/ajv-compiler/package.json'));
const Ajv=compilerRequire('ajv/dist/2020.js').default;
const addFormats=compilerRequire('ajv-formats');
const ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);
const read=(dir,name)=>JSON.parse(readFileSync(path.join(root,dir,name),'utf8'));
const schemaNames=['ai-decision.schema.json','public-api.schema.json','report-facts.schema.json','report-narrative.schema.json','internal-reward-quote.schema.json'];
for(const name of schemaNames)ajv.addSchema(read('contracts',name));
const validators=new Map(schemaNames.map(name=>[name,ajv.getSchema(read('contracts',name).$id)]));
const manifest=read('examples','manifest.json');
const fixtures=new Map();
for(const item of manifest.cases){
 const value=read('examples',item.example),validate=validators.get(item.schema);
 assert.ok(validate(value),item.example+': '+ajv.errorsText(validate.errors));fixtures.set(item.example,value);
}
function validateGraph(bundle){
 const refs=new Map(bundle.actions.map(a=>[a.local_ref,a]));assert.equal(refs.size,bundle.actions.length,'Repeated action ref');
 const visiting=new Set(),visited=new Set();
 function walk(ref){
  assert.ok(refs.has(ref),'Dangling dependency '+ref);assert.ok(!visiting.has(ref),'Dependency cycle '+ref);
  if(visited.has(ref))return;visiting.add(ref);
  for(const dep of refs.get(ref).depends_on)walk(dep);
  visiting.delete(ref);visited.add(ref);
 }
 const inspect=(value,owner)=>{
  if(!value||typeof value!=='object')return;
  if(value.kind==='local'){assert.ok(refs.has(value.local_ref),'Unknown local object');assert.ok(owner.depends_on.includes(value.local_ref),'Missing explicit dependency');}
  for(const v of Object.values(value))if(Array.isArray(v))v.forEach(x=>inspect(x,owner));else inspect(v,owner);
 };
 for(const a of bundle.actions){walk(a.local_ref);inspect(a.data,a);
  if(a.action_type==='record.create')for(const key of Object.keys(a.data.values))assert.ok(a.data.provenance.some(p=>p.field_key===key),'Missing field provenance');
 }
 if(bundle.clarification)assert.equal(bundle.actions.length,0,'Blocked clarification cannot carry executable group');
}
function validateNarrative(value,snapshot){
 assert.equal(value.snapshot_id,snapshot.snapshot_id);const facts=new Set(snapshot.facts.map(f=>f.fact_id));
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const {content_hash,...unsigned}=snapshot;assert.equal(createHash('sha256').update(JSON.stringify(canonical(unsigned))).digest('hex'),content_hash,'Snapshot checksum mismatch');
 for(const id of value.selected_fact_ids)assert.ok(facts.has(id),'Unknown selected fact');
 for(const claim of [...value.highlights,...value.concerns,...value.suggestions]){
  for(const id of claim.fact_refs)assert.ok(facts.has(id),'Unknown claim fact');
  for(const match of claim.text.matchAll(/\{\{fact:([^}]+)\}\}/g))assert.ok(claim.fact_refs.includes(match[1]),'Unlisted quantitative placeholder');
 }
}
for(const name of ['goal-plan.json','record-running.json','clarification.json'])validateGraph(fixtures.get(name));
validateNarrative(fixtures.get('report-narrative.json'),fixtures.get('report-facts.json'));
const clone=x=>structuredClone(x),negative=[];
function rejectSchema(name,schema,change){const x=clone(fixtures.get(name));change(x);assert.equal(validators.get(schema)(x),false,'Accepted malformed '+name);negative.push(name+': '+change.name);}
rejectSchema('goal-plan.json','ai-decision.schema.json',function rewardInjection(x){x.actions[4].data.reward_amount=99999;});
rejectSchema('goal-plan.json','ai-decision.schema.json',function walletAction(x){x.actions[0].action_type='wallet.credit';});
rejectSchema('goal-plan.json','ai-decision.schema.json',function directUnlock(x){x.actions[5].data.award_unlocked=true;});
rejectSchema('record-running.json','ai-decision.schema.json',function completedRecord(x){x.actions[0].data.status='completed';});
rejectSchema('record-running.json','ai-decision.schema.json',function nestedExecutableValue(x){x.actions[0].data.values.distance_km={sql:'UPDATE users'};});
rejectSchema('record-running.json','ai-decision.schema.json',function invalidTimestamp(x){x.actions[0].data.occurred_at='2026-02-30T12:00:00+08:00';});
rejectSchema('weekly-schedule.json','public-api.schema.json',function invalidTime(x){x.local_time='25:00';});
rejectSchema('chat-message.json','public-api.schema.json',function emptyRequest(x){x.text='';});
rejectSchema('auto-applied-turn.json','public-api.schema.json',function missingReceiptIdentity(x){delete x.application.operation_id;});
rejectSchema('internal-reward-quote.json','internal-reward-quote.schema.json',function dailyQuoteCap(x){x.quotes[0].amount=11;});
rejectSchema('internal-reward-quote.json','internal-reward-quote.schema.json',function quotePolicyOverride(x){x.policy_version='unlimited';});
for(const [name,mutate] of [
 ['cycle',x=>x.actions[0].depends_on.push('english_daily')],
 ['duplicate_ref',x=>x.actions[1].local_ref=x.actions[0].local_ref],
 ['unknown_local',x=>x.actions[2].data.record_type_ref.local_ref='not_present']
]){const x=clone(fixtures.get('goal-plan.json'));mutate(x);assert.throws(()=>validateGraph(x));negative.push(name);}
const wrong=clone(fixtures.get('report-narrative.json'));wrong.highlights[0].fact_refs.push('invented_money');assert.throws(()=>validateNarrative(wrong,fixtures.get('report-facts.json')));negative.push('unknown_report_fact');
const report={status:'PASS',scope:'design_contracts_only',schemas:schemaNames.length,valid_examples:manifest.cases.length,negative_cases:negative.length,negative_case_names:negative,validator:'Existing Fastify Ajv 2020 + ajv-formats',graph_and_fact_reference_checks:true,application_implemented:false,provider_api_called:false,database_accessed:false};
if(process.env.DESIGN_VALIDATION_OUTPUT)writeFileSync(process.env.DESIGN_VALIDATION_OUTPUT,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(report,null,2)+'\n');
