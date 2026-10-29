import {api,ApiClientError,generateUuid} from './api.js';
import {submitPhase2Command} from './phase2-submit.js';
import {getPendingConfigMutation} from './storage.js';
export interface MaterializationReceipt {server_time?:string;next_check_at?:string|null;instances:unknown[];reused:boolean[];total_templates?:number;}
export class PeriodicSync {
 private flight:Promise<void>|null=null;
 private next=0;
 constructor(private options:{refresh:()=>Promise<void>;state:(status:'syncing'|'ready'|'error',message?:string)=>void;send?:(payload:{},operation:string)=>Promise<MaterializationReceipt>;key?:string;now?:()=>number}){}
 private key(){
  if(this.options.key)return this.options.key;
  if(typeof window==='undefined')return 'periodic:test';
  try{let id=window.sessionStorage.getItem('life_dashboard_materialization_tab');if(!id){id=generateUuid();window.sessionStorage.setItem('life_dashboard_materialization_tab',id);}return 'periodic:'+id;}
  catch{throw new ApiClientError(400,{code:'LOCAL_STORAGE_FAILED',message:'无法保存周期刷新操作；恢复本机存储后重试。'});}
 }
 async ensure(force=false):Promise<void>{
  if(this.flight)return this.flight;
  const now=this.options.now??Date.now;if(!force&&now()<this.next)return;
  this.flight=(async()=>{
   this.options.state('syncing');
   try{
    const send=this.options.send??((_p,key)=>api.materializeTaskInstances(undefined,key));
    // Old v0.2 button operations must be acknowledged before requesting a new current period.
    if(getPendingConfigMutation('phase2:materialize'))await submitPhase2Command('create-task-template','phase2:materialize','materialize',{},send);
    const key=this.key(),pending=Boolean(getPendingConfigMutation(key));
    let response=await submitPhase2Command('create-task-template',key,'materialize',{},send);
    if(pending)response=await submitPhase2Command('create-task-template',key,'materialize',{},send);
    const r=response.result;
    this.next=r.next_check_at&&r.server_time?now()+Math.max(0,Date.parse(r.next_check_at)-Date.parse(r.server_time)):Number.POSITIVE_INFINITY;
    await this.options.refresh();this.options.state('ready');
   }catch(error){this.next=0;this.options.state('error',error instanceof Error?error.message:'周期刷新失败；尚不能确认当期任务，请重试。');throw error;}
  })();
  try{await this.flight;}finally{this.flight=null;}
 }
}
