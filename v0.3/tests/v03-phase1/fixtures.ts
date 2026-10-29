import {readFileSync} from 'node:fs';
import {DateTime} from 'luxon';
import {randomUUID} from 'node:crypto';
import type {Gateway} from '../../packages/ai/src/v03/gateway.js';
export function makePlan(context:any){
 const plan=JSON.parse(readFileSync(new URL('./goal-plan.json',import.meta.url),'utf8'));
 const source=context.input,from=DateTime.fromISO(source.received_at).setZone(source.timezone).toISODate(),until=DateTime.fromISO(from!).plus({days:29}).toISODate();
 plan.context_ref=source.id;
 function replace(v:any):any{if(typeof v==='string')return v==='90000000-0000-4000-8000-000000000001'?source.modules[0].id:v==='2026-10-20'?from:v==='2026-11-18'?until:v==='2026-11-19T00:00:00+08:00'?DateTime.fromISO(until!).plus({days:1}).setZone(source.timezone,{keepLocalTime:true}).toISO():v;if(Array.isArray(v))return v.map(replace);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='evidence_refs'?[source.evidence_refs.at(-1)]:replace(x)]));return v;}
 return replace(plan);
}
export class StubGateway implements Gateway {
 calls=0;
 constructor(readonly change:(plan:any,context:any,n:number)=>any=(p)=>p){}
 async generate(context:any,_signal:AbortSignal){this.calls++;return {value:this.change(makePlan(context),context,this.calls),model:'synthetic-offline',usage:{input:100,output:200}};}
}
export const message=(text='帮我安排未来30天每天学英语20分钟，并设置坚持成就')=>({schema_version:'client-command/1.0',client_message_id:randomUUID(),text,entrypoint:'home',execution:'auto',selected_refs:[]});
