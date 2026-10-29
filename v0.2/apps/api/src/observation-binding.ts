import {createHash} from 'node:crypto';
// A field's display label/value is not a binding change. Identity, source, type and unit are.
export function bindingFingerprint(f:any){
 return createHash('sha256').update(JSON.stringify([f.user_id??null,f.id,f.module_id,f.kind,f.type,f.unit??null,f.binding?.record_type_id??null,f.binding?.field_key??null])).digest('hex');
}
export function bindingDescriptor(f:any){return {field_id:f.id,module_id:f.module_id,kind:f.kind,type:f.type,unit:f.unit,binding:f.binding,binding_fingerprint:bindingFingerprint(f)};}
