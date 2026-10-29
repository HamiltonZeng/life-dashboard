import {DateTime} from 'luxon';
import {verifiedQuantity} from './quantity-source.js';
import {requireThat} from '../../../../packages/domain/src/index.js';
import {digest} from '../../../../packages/ai/src/v03/compiler.js';
export function explicitFact(text:string){return !/[“”「」『』"`？?]|(?:打算|计划|明天|后天|如果|假如|例如|听说|能否|是否|怎么|如何|预计|准备|将要|不要|先不|只看|预览)/.test(text)&&/(?:记一下|记录|记下|保存|跑了|吃了|喝了|学了|完成了|体重|今天|昨天|刚刚)/.test(text);}
export function verifyValue(value:any,p:any,context:any,field?:any){
 const source=context.evidence?.find((e:any)=>e.ref===p.evidence_ref);requireThat(source,'INVALID_REFERENCE','字段来源不存在。');
 requireThat(typeof p.quote==='string'&&p.quote.trim().length>0&&source.text.includes(p.quote),'INVALID_PROVENANCE','字段原文无法定位。');
 requireThat(p.source_type==='authorized_context'?source.kind==='context':source.kind==='user','INVALID_PROVENANCE','来源类型不匹配。');
 const raw=String(p.original_value);
 if(p.original_value!==null&&(['integer','decimal'].includes(field?.type)||typeof p.original_value==='number'))return verifiedQuantity(value,p,source.text,field);
 requireThat(p.original_value===null||p.quote.includes(raw),'INVALID_PROVENANCE','来源不包含该原值。');
 requireThat(digest(value)===digest(p.original_value)||String(value)===raw,'INVALID_PROVENANCE','真实字段不得使用推测值。');
 return p;
}
export function verifyFields(values:any,provenance:any[],context:any,fields:any[]){
 requireThat(provenance.length===Object.keys(values).length&&new Set(provenance.map(p=>p.field_key)).size===provenance.length,'INVALID_PROVENANCE','每个写入字段须有唯一来源。');
 return Object.entries(values).map(([key,value])=>{const field=fields.find(f=>f.key===key),p=provenance.find(p=>p.field_key===key);requireThat(field&&p,'INVALID_PROVENANCE','字段或来源缺失。');return verifyValue(value,p,context,field);});
}
export function verifiedTime(d:any,context:any){
 const texts=[context.original_text,...context.answers],text=texts.join('\n'),zone=d.timezone??context.timezone,anchor=DateTime.fromISO(context.received_at,{zone}),at=DateTime.fromISO(d.occurred_at,{zone}).setZone(zone);
 requireThat(at.isValid&&at<=anchor,'INVALID_OCCURRENCE','发生时间无效或在未来。');
 const {dated,clockEvidence}=timeEvidence(context,zone);
 if(dated)requireThat([...dated.dates,...dated.relative].includes(at.toISODate()),'INVALID_OCCURRENCE','发生日期与用户明确的日期不一致。');
 if(d.time_basis==='received_time'){requireThat(!dated&&!clockEvidence,'INVALID_OCCURRENCE','用户已提供发生日期或时刻，不能改用接收时间。');requireThat(d.time_precision==='approximate','INVALID_OCCURRENCE','接收时间只能作为近似时间。');return {occurred_at:context.received_at,time_precision:d.time_precision,time_basis:d.time_basis};}
 if(d.time_basis==='relative_date'){
  const relative=dated?.relative??(/刚刚|刚才/.test(text)?[anchor.toISODate()]:[]);
  requireThat(relative.includes(at.toISODate()),'INVALID_OCCURRENCE','相对日期必须锚定首次接收时间。');
 }else if(d.time_basis==='explicit_date'||d.time_basis==='explicit_datetime'){
  requireThat(dated?.dates.includes(at.toISODate()!),'INVALID_OCCURRENCE','日期必须出现在用户来源中。');
 }else if(d.time_basis==='authorized_context'){
  requireThat(context.records?.some((r:any)=>Date.parse(r.occurred_at)===at.toMillis()),'INVALID_OCCURRENCE','上下文中没有该发生时间。');
 }
 if(d.time_precision==='instant')requireThat(text.includes(at.toFormat('HH:mm'))||text.includes(`${at.hour}点${at.minute}`),'CLARIFICATION_REQUIRED','缺少精确活动时刻，请补充或使用日期精度。');
 if(d.time_precision==='day')return {occurred_at:at.startOf('day').toUTC().toISO(),time_precision:'day',time_basis:d.time_basis};
 return {occurred_at:at.toUTC().toISO(),time_precision:d.time_precision,time_basis:d.time_basis};
}

function timeEvidence(context:any,zone:string){
 const texts=[context.original_text,...(context.answers??[])],text=texts.join('\n'),anchor=DateTime.fromISO(context.received_at,{zone});
 const dated=texts.map((statement:string)=>{
  const dates=[...statement.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m=>m[1]);
  for(const m of statement.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g))dates.push(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
  const relative=[...statement.matchAll(/前天|昨天|今天|明天|后天/g)].map(m=>anchor.plus({days:({'前天':-2,'昨天':-1,'今天':0,'明天':1,'后天':2} as Record<string,number>)[m[0]]}).toISODate());
  return {dates,relative};
 }).findLast((e:any)=>e.dates.length||e.relative.length);
 const clockEvidence=/\b\d{1,2}:\d{2}\b|\d{1,2}点/.test(text);
 return {dated,clockEvidence};
}

export function defaultObservationTime(context:any){
 const zone=context.timezone,{dated,clockEvidence}=timeEvidence(context,zone);
 requireThat(!clockEvidence,'CLARIFICATION_REQUIRED','用户提供了活动时刻，请补充可核对的发生时间。',409);
 if(dated){const days=[...new Set([...dated.dates,...dated.relative])];requireThat(days.length===1,'CLARIFICATION_REQUIRED','存在多个发生日期，请明确这次观测的日期。',409);return verifiedTime({timezone:zone,occurred_at:DateTime.fromISO(days[0]!,{zone}).startOf('day').toUTC().toISO(),time_precision:'day',time_basis:dated.dates.length?'explicit_date':'relative_date'},context);}
 return verifiedTime({timezone:zone,occurred_at:context.received_at,time_precision:'approximate',time_basis:'received_time'},context);
}
