import type {Client} from '../../../packages/db/src/client.js';
export interface Core {
 now:()=>Date;
 event(c:Client,user:string,kind:string,id:string,version:number,payload:unknown):Promise<void>;
 module(c:Client,user:string,id:string,active?:boolean):Promise<any>;
 type(c:Client,user:string,module:string,id:string):Promise<any>;
 facts(c:Client,user:string):Promise<any[]>;
 execute(c:Client,user:string,method:string,path:string,body:unknown):Promise<any>;
}
