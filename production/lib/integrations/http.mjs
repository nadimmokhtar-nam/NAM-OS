// Server-only API transport. Never attach upstream response bodies to errors:
// they may contain client information or echoed credentials.
export class IntegrationError extends Error {
  constructor(code,message,{retryAt=null}={}){super(message);this.name='IntegrationError';this.code=code;this.retryAt=retryAt;}
}
export function retryTime(value,now=new Date()){
  if(value==null||value==='')return new Date(now.getTime()+60000).toISOString();
  const seconds=Number(value);if(value!==null&&Number.isFinite(seconds)&&seconds>=0)return new Date(now.getTime()+Math.min(seconds,86400)*1000).toISOString();
  const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():new Date(now.getTime()+60000).toISOString();
}
export function transport({source,origin,authorization,fetchImpl=globalThis.fetch,clock=()=>new Date(),timeoutMs=12000,paceMs=150,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  let previous=0;
  return async(path,{method='GET',body}={})=>{
    const url=new URL(path,origin);if(url.origin!==origin||url.username||url.password)throw new IntegrationError('invalid_response','The service returned an unsafe pagination link.');
    const wait=paceMs-(Date.now()-previous);if(wait>0)await sleep(wait);previous=Date.now();
    let response;
    try{response=await fetchImpl(url,{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json',Authorization:authorization,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new IntegrationError('unavailable',`${source} could not be reached. Retry when the connection is available.`);}
    if(response.status===401)throw new IntegrationError('expired',`${source} credentials were rejected. Update the server connection.`);
    if(response.status===403)throw new IntegrationError('permission_denied',`${source} denied access. Check API permissions and plan access.`);
    if(response.status===429)throw new IntegrationError('rate_limited',`${source} is rate limiting requests. Retry after the indicated time.`,{retryAt:retryTime(response.headers.get('retry-after'),clock())});
    if(response.status>=500)throw new IntegrationError('unavailable',`${source} is temporarily unavailable. The last successful sync is retained.`);
    if(!response.ok)throw new IntegrationError('configuration_error',`${source} returned HTTP ${response.status}. Check the connection configuration.`);
    const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>8_000_000)throw new IntegrationError('invalid_response','The service response exceeded the supported size.');
    let raw;try{raw=await response.text();}catch{throw new IntegrationError('invalid_response','The service response could not be read.');}
    if(raw.length>8_000_000)throw new IntegrationError('invalid_response','The service response exceeded the supported size.');
    try{return JSON.parse(raw);}catch{throw new IntegrationError('invalid_response',`${source} returned an unreadable response. No records were changed.`);}
  };
}
export function arrayBody(value,keys=[]){if(Array.isArray(value))return value;for(const key of keys)if(Array.isArray(value?.[key]))return value[key];throw new IntegrationError('invalid_response','The service returned an unexpected record format. No records were changed.');}
export function stableId(value){if((typeof value!=='string'&&typeof value!=='number')||(typeof value==='number'&&!Number.isFinite(value))||!String(value)||String(value).length>300)throw new IntegrationError('invalid_response','A service record is missing its stable identifier. No records were changed.');return String(value);}
export function safeText(value,max=5000){return typeof value==='string'?value.slice(0,max):null;}
export function safeUrl(value,hosts){if(typeof value!=='string')return null;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&hosts.some(h=>u.hostname===h||u.hostname.endsWith(`.${h}`))?u.href:null;}catch{return null;}}
export function dateISO(value){if(!value)return null;const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null;}
