/** Phase34: narrowly scoped Telegram sender. Disabled by default.
 * No broker order, Telegram read/update API, general HTTP URL or credential
 * persistence. Return only minimal fields for durable Phase24 settlement.
 */
const fail=code=>{throw Error(`TELEGRAM_SENDER_${code}`);};
const MAX_RESPONSE_BYTES=4096;
const MAX_REQUEST_MS=4000;
const tokenPattern=/^[0-9]{7,12}:[A-Za-z0-9_-]{35,128}$/;
const chatPattern=/^[1-9][0-9]{0,15}$/;
const safeTime=n=>Number.isSafeInteger(n)&&n>0;

export function validPrivateTelegramConfig({token,chatId}={}) {
  if(typeof token!=='string'||!tokenPattern.test(token)||
      typeof chatId!=='string'||!chatPattern.test(chatId)) return false;
  const numeric=Number(chatId);
  return Number.isSafeInteger(numeric)&&numeric>0&&
    String(numeric)===chatId;
}

/** A missing, unreadable or ambiguous response is never a definite failure.
 * Reconciliation must persist AMBIGUOUS instead of attempting another send.
 */
const ambiguous=()=>({httpStatus:null,botResponse:null});
async function boundedResponseBody(response) {
  if(!response?.body?.getReader) return null;
  const reader=response.body.getReader();
  const parts=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      if(!(value instanceof Uint8Array)) return null;
      size+=value.byteLength;
      if(size>MAX_RESPONSE_BYTES) {await reader.cancel();return null;}
      parts.push(value);
    }
  } finally {reader.releaseLock();}
  const combined=new Uint8Array(size);let offset=0;
  for(const part of parts){combined.set(part,offset);offset+=part.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));}
  catch {return null;}
}

/**
 * Send a single already-claimed paper alert. A token is needed only in
 * temporary Worker memory; never put it in Durable Object state or logs.
 * The complete URL includes the Telegram API token by protocol design,
 * so thrown fetch errors, request objects and redirects are never logged.
 */
export async function sendTelegramPaperMessage({token,chatId,message,
  fetchImpl=fetch,timeoutMs=MAX_REQUEST_MS}={}) {
  if(!validPrivateTelegramConfig({token,chatId})) fail('INVALID_PRIVATE_CONFIG');
  if(typeof message!=='string'||message.length<1||message.length>1200)
    fail('INVALID_PAPER_MESSAGE');
  if(typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||
      timeoutMs<250||timeoutMs>MAX_REQUEST_MS) fail('INVALID_TRANSPORT');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`,{
      method:'POST',redirect:'error',signal:controller.signal,
      headers:{'Content-Type':'application/json; charset=utf-8',Accept:'application/json'},
      body:JSON.stringify({chat_id:Number(chatId),text:message,
        disable_notification:false,protect_content:true}),
    });
    if(!response||!Number.isSafeInteger(response.status)||
        ![200,400,401,403,404,429].includes(response.status)) return ambiguous();
    const contentType=response.headers?.get('content-type')??'';
    if(!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) return ambiguous();
    const body=await boundedResponseBody(response);
    if(!body||typeof body!=='object'||Array.isArray(body))return ambiguous();
    if(response.status===200 && body.ok===true &&
        safeTime(body.result?.message_id)&&
        body.result?.chat?.id===Number(chatId)) {
      return {httpStatus:200,botResponse:{ok:true,
        result:{message_id:body.result.message_id}}};
    }
    if(response.status===429 && body.ok===false&&body.error_code===429&&
        Number.isSafeInteger(body.parameters?.retry_after)&&
        body.parameters.retry_after>=1&&body.parameters.retry_after<=86400) {
      return {httpStatus:429,botResponse:{ok:false,error_code:429,
        parameters:{retry_after:body.parameters.retry_after}}};
    }
    if([400,401,403,404].includes(response.status)&&body.ok===false&&
        body.error_code===response.status) {
      return {httpStatus:response.status,
        botResponse:{ok:false,error_code:response.status}};
    }
    return ambiguous();
  } catch {return ambiguous();}
  finally {clearTimeout(timer);}
}
