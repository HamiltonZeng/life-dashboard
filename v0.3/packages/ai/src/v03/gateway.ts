import {DomainError} from '../../../domain/src/index.js';
export interface GatewayResult {value:unknown;model:string;usage:null|{input:number;output:number}}
export interface Gateway {generate(context:any,signal:AbortSignal):Promise<GatewayResult>}
const finite=(env:NodeJS.ProcessEnv,key:string,fallback:number,max:number)=>{
 const raw=env[key]?.trim();
 const n=raw===undefined||raw===''?fallback:Number(raw);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`Invalid finite AI limit: ${key}`);return n;
};
export function gatewayConfig(env:NodeJS.ProcessEnv=process.env){
 const enabled=env.V03_AI_ENABLED==='1',apiKey=(env.DEEPSEEK_API_KEY??'').trim(),model=(env.DEEPSEEK_MODEL??'').trim()||'deepseek-flash';
 const baseUrl=(env.DEEPSEEK_BASE_URL??'').trim()||'https://api.deepseek.com';
 if(enabled){const url=new URL(baseUrl);if(url.protocol!=='https:'||url.username||url.password)throw new Error('DeepSeek endpoint requires HTTPS without credentials');}
 const rawThinking=(env.V03_AI_THINKING??'').trim();
 if(rawThinking!==''&&rawThinking!=='enabled'&&rawThinking!=='disabled')throw new Error('Invalid V03_AI_THINKING');
 const thinking:'enabled'|'disabled'|null=rawThinking?(rawThinking as 'enabled'|'disabled'):(model==='deepseek-flash'?'enabled':null);
 const rawEffort=(env.V03_AI_REASONING_EFFORT??'').trim();
 const validEfforts=['none','low','medium','high','max'] as const;
 if(rawEffort!==''&&!(validEfforts as readonly string[]).includes(rawEffort))throw new Error('Invalid V03_AI_REASONING_EFFORT');
 const reasoningEffort:(typeof validEfforts)[number]|null=rawEffort?(rawEffort as (typeof validEfforts)[number]):(thinking==='enabled'?'high':null);
 const rawTemp=(env.V03_AI_TEMPERATURE??'').trim();
 let temperature:number|null=null;
 if(rawTemp!==''){const t=Number(rawTemp);if(!Number.isFinite(t)||t<0||t>2)throw new Error('Invalid V03_AI_TEMPERATURE');temperature=t;}
 return {rewardPricing:env.V03_AI_REWARD_PRICING!=='0',enabled,apiKey,model,baseUrl,thinking,reasoningEffort,temperature,configured:!!apiKey&&!!model,
 dailyJobs:finite(env,'V03_AI_DAILY_JOBS',30,1000),dailyInput:finite(env,'V03_AI_DAILY_INPUT_TOKENS',1000000,10000000),dailyOutput:finite(env,'V03_AI_DAILY_OUTPUT_TOKENS',200000,1000000),
 maxInput:finite(env,'V03_AI_MAX_INPUT_TOKENS',100000,200000),maxOutput:finite(env,'V03_AI_MAX_OUTPUT_TOKENS',12000,20000),attemptMs:finite(env,'V03_AI_ATTEMPT_MS',90000,180000),runMs:finite(env,'V03_AI_RUN_MS',240000,600000),maxAttempts:2};
}
export type GatewayConfig=ReturnType<typeof gatewayConfig>;
export class DeepSeekGateway implements Gateway {
 constructor(readonly config:GatewayConfig,readonly fetcher:typeof fetch=fetch){}
 async generate(context:any,signal:AbortSignal):Promise<GatewayResult>{
  const c=this.config;
  if(!c.enabled||!c.configured)throw new DomainError('AI_NOT_CONFIGURED','请在服务器配置 DeepSeek 并启用连接。',409);
  const payloadBody:Record<string,unknown>={
   model:c.model,response_format:{type:'json_object'},max_tokens:c.maxOutput,stream:false,
   messages:[{role:'system',content:context.instructions},{role:'user',content:JSON.stringify(context.input)}]
  };
  if(c.thinking)payloadBody.thinking={type:c.thinking};
  if(c.reasoningEffort)payloadBody.reasoning_effort=c.reasoningEffort;
  if(c.thinking!=='enabled')payloadBody.temperature=c.temperature??0.2;
  let response:Response;
  try {response=await this.fetcher(c.baseUrl.replace(/\/+$/,'')+'/chat/completions',{
   method:'POST',signal,headers:{Authorization:`Bearer ${c.apiKey}`,'Content-Type':'application/json'},
   body:JSON.stringify(payloadBody)
  });}catch(e){if(signal.aborted)throw new DomainError('AI_TIMEOUT','模型请求已超时或取消。',503);throw new DomainError('AI_UNAVAILABLE','模型服务暂时不可用。',503);}
  const cancelBody=()=>{void response.body?.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancelBody,{once:true});
  if(signal.aborted){cancelBody();throw new DomainError('AI_TIMEOUT','模型请求已超时或取消。',503);}
  let text:string;
  let onAbortText:(()=>void)|undefined;
  try{
   if(!response.ok){
    cancelBody();
    const map:Record<number,[string,string,number]>={
     400:['AI_BAD_REQUEST','模型请求参数或模型名称不被接受，请检查服务端配置。',422],
     422:['AI_BAD_REQUEST','模型请求参数或模型名称不被接受，请检查服务端配置。',422],
     401:['AI_AUTH','模型服务拒绝请求，请检查连接或额度。',503],
     403:['AI_AUTH','模型服务拒绝请求，请检查连接或额度。',503],
     402:['AI_QUOTA','模型服务拒绝请求，请检查连接或额度。',503],
     429:['AI_RATE_LIMIT','模型服务拒绝请求，请检查连接或额度。',503]
    };
    const [code,msg,status]=map[response.status]??['AI_UNAVAILABLE','模型服务拒绝请求，请检查连接或额度。',503];
    throw new DomainError(code,msg,status);
   }
   try{
    text=await Promise.race([
     response.text(),
     new Promise<never>((_,reject)=>{
      onAbortText=()=>{cancelBody();reject(new DomainError('AI_TIMEOUT','模型请求已超时或取消。',503));};
      signal.addEventListener('abort',onAbortText,{once:true});
     })
    ]);
   }catch(e){
    if(e instanceof DomainError)throw e;
    if(signal.aborted)throw new DomainError('AI_TIMEOUT','模型请求已超时或取消。',503);
    throw new DomainError('AI_UNAVAILABLE','模型响应读取中断。',503);
   }
   if(signal.aborted)throw new DomainError('AI_TIMEOUT','模型请求已超时或取消。',503);
  }finally{
   signal.removeEventListener('abort',cancelBody);
   if(onAbortText)signal.removeEventListener('abort',onAbortText);
  }
  if(text.length>300000)throw new DomainError('AI_INVALID_OUTPUT','模型输出过大。',422);
  let body:any;try{body=JSON.parse(text);}catch{throw new DomainError('AI_INVALID_OUTPUT','模型返回了无效响应。',422);}
  if(!body||typeof body!=='object')throw new DomainError('AI_INVALID_OUTPUT','模型返回了无效响应。',422);
  const choice=body.choices?.[0];
  if(choice?.finish_reason==='length')throw new DomainError('AI_OUTPUT_TRUNCATED','模型输出被截断。',422);
  const content=choice?.message?.content;
  if(typeof content!=='string'||!content.trim())throw new DomainError('AI_INVALID_OUTPUT','模型没有返回有效内容。',422);
  const trimmed=content.trim();
  const fenced=trimmed.match(/^```(?:json|JSON)?\s*\r?\n?([\s\S]*?)\r?\n?```$/);
  const jsonText=(fenced?fenced[1]:trimmed).trim();
  let value:unknown;try{value=JSON.parse(jsonText);}catch{throw new DomainError('AI_INVALID_OUTPUT','模型输出不是有效 JSON。',422);}
  const u=body.usage;
  const usage=u&&Number.isSafeInteger(u.prompt_tokens)&&u.prompt_tokens>=0&&Number.isSafeInteger(u.completion_tokens)&&u.completion_tokens>=0?{input:u.prompt_tokens,output:u.completion_tokens}:null;
  return {value,model:typeof body.model==='string'?body.model:c.model,usage};
 }
}
