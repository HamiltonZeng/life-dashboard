import {DomainError} from '../../../domain/src/index.js';
export interface GatewayResult {value:unknown;model:string;usage:null|{input:number;output:number}}
export interface Gateway {generate(context:any,signal:AbortSignal):Promise<GatewayResult>}
const finite=(env:NodeJS.ProcessEnv,key:string,fallback:number,max:number)=>{
 const n=Number(env[key]??fallback);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`Invalid finite AI limit: ${key}`);return n;
};
export function gatewayConfig(env:NodeJS.ProcessEnv=process.env){
 const enabled=env.V03_AI_ENABLED==='1',apiKey=env.DEEPSEEK_API_KEY??'',model=env.DEEPSEEK_MODEL??'';
 const baseUrl=env.DEEPSEEK_BASE_URL??'https://api.deepseek.com';
 if(enabled){const url=new URL(baseUrl);if(url.protocol!=='https:')throw new Error('DeepSeek endpoint requires HTTPS');}
 return {rewardPricing:env.V03_AI_REWARD_PRICING!=='0',enabled,apiKey,model,baseUrl,configured:!!apiKey&&!!model,
 dailyJobs:finite(env,'V03_AI_DAILY_JOBS',20,1000),dailyInput:finite(env,'V03_AI_DAILY_INPUT_TOKENS',100000,10000000),dailyOutput:finite(env,'V03_AI_DAILY_OUTPUT_TOKENS',20000,1000000),
 maxInput:finite(env,'V03_AI_MAX_INPUT_TOKENS',32000,100000),maxOutput:finite(env,'V03_AI_MAX_OUTPUT_TOKENS',4000,20000),attemptMs:60000,runMs:180000,maxAttempts:2};
}
export type GatewayConfig=ReturnType<typeof gatewayConfig>;
export class DeepSeekGateway implements Gateway {
 constructor(readonly config:GatewayConfig,readonly fetcher:typeof fetch=fetch){}
 async generate(context:any,signal:AbortSignal):Promise<GatewayResult>{
  const c=this.config;
  if(!c.enabled||!c.configured)throw new DomainError('AI_NOT_CONFIGURED','请在服务器配置 DeepSeek 并启用连接。',409);
  let response:Response;
  try {response=await this.fetcher(c.baseUrl.replace(/\/$/,'')+'/chat/completions',{
   method:'POST',signal,headers:{Authorization:`Bearer ${c.apiKey}`,'Content-Type':'application/json'},
   body:JSON.stringify({model:c.model,response_format:{type:'json_object'},max_tokens:c.maxOutput,messages:[
    {role:'system',content:context.instructions},{role:'user',content:JSON.stringify(context.input)}]})
  });}catch(e){if(signal.aborted)throw new DomainError('AI_TIMEOUT','模型请求已超时或取消。',503);throw new DomainError('AI_UNAVAILABLE','模型服务暂时不可用。',503);}
  if(!response.ok){const code=({401:'AI_AUTH',403:'AI_AUTH',402:'AI_QUOTA',429:'AI_RATE_LIMIT'} as Record<number,string>)[response.status]??'AI_UNAVAILABLE';throw new DomainError(code,'模型服务拒绝请求，请检查连接或额度。',503);}
  const text=await response.text();if(text.length>300000)throw new DomainError('AI_INVALID_OUTPUT','模型输出过大。',422);
  let body:any;try{body=JSON.parse(text);}catch{throw new DomainError('AI_INVALID_OUTPUT','模型返回了无效响应。',422);}
  const choice=body.choices?.[0];
  if(choice?.finish_reason==='length')throw new DomainError('AI_OUTPUT_TRUNCATED','模型输出被截断。',422);
  const content=choice?.message?.content;
  if(typeof content!=='string'||!content.trim())throw new DomainError('AI_INVALID_OUTPUT','模型没有返回有效内容。',422);
  let value:unknown;try{value=JSON.parse(content);}catch{throw new DomainError('AI_INVALID_OUTPUT','模型输出不是有效 JSON。',422);}
  const u=body.usage;
  const usage=u&&Number.isSafeInteger(u.prompt_tokens)&&u.prompt_tokens>=0&&Number.isSafeInteger(u.completion_tokens)&&u.completion_tokens>=0?{input:u.prompt_tokens,output:u.completion_tokens}:null;
  return {value,model:typeof body.model==='string'?body.model:c.model,usage};
 }
}
