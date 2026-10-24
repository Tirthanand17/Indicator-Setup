import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramPaperMessage,validPrivateTelegramConfig } from './telegram-sender.mjs';

const token='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrst';
const chatId='123456789';
const message='SIMULATED ONLY NIFTY paper CE candidate; no actual order';
const input=(fetchImpl)=>({token,chatId,message,fetchImpl});

test('accepts only pinned numeric private chat and plausible bot secret shape',async()=>{
  assert.equal(validPrivateTelegramConfig({token,chatId}),true);
  for(const invalid of ['@public_channel','-10012345','0','1e9','00123',
    '99999999999999999'])
    assert.equal(validPrivateTelegramConfig({token,chatId:invalid}),false);
  assert.equal(validPrivateTelegramConfig({token:'bad',chatId}),false);
  await assert.rejects(sendTelegramPaperMessage({token:'bad',chatId,message,
    fetchImpl:()=>{throw Error('must not fetch');}}),/INVALID_PRIVATE_CONFIG/);
});

test('sends only a single HTTPS JSON POST to the configured private chat',async()=>{
  let requests=0;
  const result=await sendTelegramPaperMessage(input(async(url,options)=>{
    requests++;
    assert.equal(url,`https://api.telegram.org/bot${token}/sendMessage`);
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Accept,'application/json');
    const body=JSON.parse(options.body);
    assert.deepEqual(body,{chat_id:123456789,text:message,
      disable_notification:false,protect_content:true});
    assert.equal(options.signal.aborted,false);
    return Response.json({ok:true,result:{message_id:321,
      chat:{id:123456789},text:message}});
  }));
  assert.equal(requests,1);
  assert.deepEqual(result,{httpStatus:200,botResponse:{ok:true,
    result:{message_id:321}}});
  assert.equal(JSON.stringify(result).includes(message),false);
  assert.equal(JSON.stringify(result).includes(token),false);
});

test('wrong recipient, zero message ID and malformed successes remain ambiguous',async()=>{
  const bodies=[{ok:true,result:{message_id:7,chat:{id:999}}},
    {ok:true,result:{message_id:0,chat:{id:123456789}}},
    {ok:true,result:{message_id:7}},
    {ok:false,error_code:200},
    {ok:true,result:{message_id:7,chat:{id:123456789}},
      unexpected:'x'.repeat(5000)}];
  for(const body of bodies) {
    const r=await sendTelegramPaperMessage(input(async()=>Response.json(body)));
    assert.deepEqual(r,{httpStatus:null,botResponse:null});
  }
});

test('Telegram 429 retry-after and clear 4xx are reduced to safe metadata',async()=>{
  const rate=await sendTelegramPaperMessage(input(async()=>Response.json({
    ok:false,error_code:429,description:'token and user details hidden',
    parameters:{retry_after:7}},{status:429})));
  assert.deepEqual(rate,{httpStatus:429,botResponse:{ok:false,error_code:429,
    parameters:{retry_after:7}}});
  const forbidden=await sendTelegramPaperMessage(input(async()=>Response.json({
    ok:false,error_code:403,description:'sensitive chat context'},{status:403})));
  assert.deepEqual(forbidden,{httpStatus:403,botResponse:{ok:false,error_code:403}});
  const badRate=await sendTelegramPaperMessage(input(async()=>Response.json({
    ok:false,error_code:429,parameters:{retry_after:999999}},{status:429})));
  assert.deepEqual(badRate,{httpStatus:null,botResponse:null});
});

test('timeout, malformed JSON, wrong content type, 5xx and fetch errors never claim delivery',async()=>{
  const cases=[async()=>{throw Error('could contain bot token '+token);},
    async()=>new Response('not json',{status:200,headers:{'content-type':'application/json'}}),
    async()=>new Response('<html/>',{status:200,headers:{'content-type':'text/html'}}),
    async()=>Response.json({ok:false,error_code:500},{status:500})];
  for(const fetchImpl of cases) {
    assert.deepEqual(await sendTelegramPaperMessage(input(fetchImpl)),
      {httpStatus:null,botResponse:null});
  }
  const aborted=await sendTelegramPaperMessage({token,chatId,message,timeoutMs:250,
    fetchImpl:(_url,opts)=>new Promise((resolve,reject)=>{
      opts.signal.addEventListener('abort',()=>reject(Error('abort')),{once:true});
    })});
  assert.deepEqual(aborted,{httpStatus:null,botResponse:null});
});
