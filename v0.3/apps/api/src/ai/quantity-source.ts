import {Decimal} from 'decimal.js';
import {requireThat} from '../../../../packages/domain/src/index.js';
const normalize=(s:string)=>s.normalize('NFKC').replace(/[−﹣]/g,'-').toLowerCase();
const aliases:Record<string,string>={公里:'km',千米:'km',km:'km',米:'m',m:'m',厘米:'cm',cm:'cm',毫米:'mm',mm:'mm',英里:'mi',mile:'mi',miles:'mi',mi:'mi',分钟:'min',分:'分',min:'min',小时:'h',h:'h',秒:'s',s:'s',千克:'kg',公斤:'kg',kg:'kg',克:'g',g:'g',斤:'jin',千卡:'kcal',kcal:'kcal',毫升:'ml',ml:'ml',升:'l',l:'l',次:'次',个:'个',天:'天',岁:'岁',页:'页','%':'%'};
const canonical=(s:string)=>aliases[normalize(s)]??normalize(s);
function unitAfter(source:string,end:number,fieldUnit:string|null){
 const tail=source.slice(end).trimStart(),units=[...Object.keys(aliases),...(fieldUnit?[normalize(fieldUnit)]:[])].sort((a,b)=>b.length-a.length);
 for(const unit of units)if(tail.startsWith(unit)&&(!/^[a-z]+$/.test(unit)||!/[a-z]/.test(tail[unit.length]??'')))return {unit:canonical(unit),literal:unit};
 // An attached unknown word is not permission to invent a default unit.
 const unknown=tail.match(/^(?:[a-zµμ]+|[\p{Script=Han}]+)/u)?.[0];return unknown?{unit:canonical(unknown),literal:unknown}:null;
}
/** Locate the whole quantity in the original source, not in an attacker-chosen
 * substring. Numeric equality permits harmless lexical normalization (+3/3.0),
 * but never drops a sign, decimal prefix or exponent. Units come from the same
 * occurrence, including a unit deliberately omitted from the quoted substring. */
export function verifiedQuantity(value:any,p:any,sourceText:string,field:any){
 const text=normalize(sourceText),quote=normalize(p.quote),raw=new Decimal(String(p.original_value)),target=new Decimal(String(value)),fieldUnit=field?.unit??null,declared=p.original_unit===null?null:canonical(p.original_unit);
 requireThat(raw.isFinite()&&target.isFinite(),'INVALID_PROVENANCE','来源数值无效。');
 const numbers=[...text.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/g)];
 let chosen:{unit:string;literal:string;basis:string}|undefined;
 for(let offset=text.indexOf(quote);offset>=0;offset=text.indexOf(quote,offset+1)){
  for(const token of numbers){const start=token.index!,end=start+token[0].length;if(start<offset||end>offset+quote.length||!new Decimal(token[0]).eq(raw))continue;
   if(/[/]/.test(text[start-1]??'')||/[/]/.test(text[end]??'')||/\d:$/.test(text.slice(0,start))||/^:\d/.test(text.slice(end))||/\d[,，]\s*$/.test(text.slice(0,start))||/^[,，]\s*\d/.test(text.slice(end)))continue;
   const explicit=unitAfter(text,end,fieldUnit),actual=explicit?.unit??(fieldUnit?canonical(fieldUnit):null);
   if(declared!==null&&declared!==actual)continue;
   if(p.source_type==='unit_conversion'){
    if(!explicit||declared!==actual)continue;
   }else if(actual!==(fieldUnit?canonical(fieldUnit):null))continue;
   chosen={unit:actual??'',literal:explicit?.literal??fieldUnit??'',basis:explicit?'source_fragment':'authorized_field_default'};break;
  }if(chosen)break;
 }
 requireThat(chosen,'INVALID_PROVENANCE','完整数值及单位无法在同一来源片段中核对，请补充明确数量。');
 if(p.source_type==='unit_conversion'){
  const ratios:Record<string,[string,string]>={'m:km':['1','1000'],'km:m':['1000','1'],'h:min':['60','1'],'min:h':['1','60'],'min:s':['60','1'],'g:kg':['1','1000'],'jin:kg':['1','2']};
  const ratio=ratios[chosen.unit+':'+canonical(fieldUnit??'')];requireThat(ratio,'INVALID_UNIT','不支持该来源单位换算，请补充目标单位的真实数值。');
  requireThat(raw.mul(ratio[0]).div(ratio[1]).eq(target),'INVALID_UNIT','换算结果不正确。');
  return {...p,original_unit:chosen.literal,unit_basis:chosen.basis,conversion:{formula:`value * ${ratio[0]} / ${ratio[1]}`,target_unit:fieldUnit}};
 }
 requireThat(raw.eq(target),'INVALID_PROVENANCE','真实字段不得改写来源数值。');return {...p,original_unit:chosen.literal||null,unit_basis:chosen.basis};
}
