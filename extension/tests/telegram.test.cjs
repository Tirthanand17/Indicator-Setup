'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../telegram.js');

const token='123456789:abcdefghijklmnopqrstuvwxyzABCDEFG_123456';
test('bot token and private chat identifiers are strictly validated',()=>{
 assert.equal(T.validToken(token),true);
 assert.equal(T.validToken('not-a-token'),false);
 assert.equal(T.validChatId('123456789'),true);
 assert.equal(T.validChatId('-1001234567890'),true);
 assert.equal(T.validChatId('@otheruser'),false);
});
test('pairing code uses 48 bits of provided bytes, predictable only in this test',()=>{
 const code=T.pairingCode(Uint8Array.from([1,2,255,7,8,9]));
 assert.equal(code,'0102FF070809');
});
test('only a recent matching private /start CODE pairs to the phone',()=>{
 const code='AABBCCDDEEFF';const start=1792380000;
 const updates=[
  {update_id:1,message:{date:start+2,chat:{id:555555,type:'group'},text:'/start '+code}},
  {update_id:2,message:{date:start-5,chat:{id:12345678,type:'private'},text:'/start '+code}},
  {update_id:3,message:{date:start+4,chat:{id:98765432,type:'private'},text:'/start '+code}},
  {update_id:4,message:{date:start+5,chat:{id:87654321,type:'private'},text:'/start WRONG'}}
 ];
 assert.equal(T.findPairingChat(updates,code,start),'98765432');
 assert.equal(T.findPairingChat(updates,'000000000000',start),null);
});
test('ambiguous multiple private chats fail closed',()=>{
 const code='ABCDEF123456';
 const updates=[1,2].map(x=>({message:{date:2000,chat:{id:x+10000,type:'private'},text:'/start '+code}}));
 assert.equal(T.findPairingChat(updates,code,1999),null);
});
test('Telegram request sends POST JSON and no browser credentials',async()=>{
 let opts,endpoint;const fake=async(url,options)=>{endpoint=url;opts=options;return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:7}})};};
 const out=await T.callTelegram(token,'sendMessage',{chat_id:'12345678',text:'TEST'},fake);
 assert.equal(out.message_id,7);assert.equal(opts.method,'POST');
 assert.equal(opts.credentials,'omit');assert.equal(opts.cache,'no-store');
 assert.equal(endpoint,'https://api.telegram.org/bot'+token+'/sendMessage');
 assert.deepEqual(JSON.parse(opts.body),{chat_id:'12345678',text:'TEST'});
});
test('Telegram API error does not leak the token or chat details',async()=>{
 let error;
 try{await T.callTelegram(token,'sendMessage',{chat_id:'12345678',text:'test'},async()=>({ok:false,status:403}));}
 catch(e){error=e;}
 assert.ok(error);assert.match(error.message,/403/);assert.equal(error.message.includes(token),false);
 await assert.rejects(()=>T.callTelegram(token,'getFile',{},async()=>({ok:true,json:async()=>({ok:true,result:1})})),/Unsupported/);
});
test('provisional CE and exit alerts include risk caveats and only chart fields',()=>{
 const bar={symbol:'NIFTY26OCTFUT',end:Date.parse('2026-10-19T10:35:00+05:30'),close:22955,vwap:22900,ema9:22941,ema21:22915,plusDI:29,minusDI:12,adx:27,atr:35};
 const ce=T.paperSignalText({status:'REVIEW_CE',bar});
 const ex=T.paperSignalText({status:'EXIT_CE',bar,virtual:{direction:'CE'},reason:'Underlying invalidation'});
 assert.match(ce,/POTENTIAL BUY CE/);assert.match(ce,/No orders placed/);
 assert.match(ce,/option ASK\/BID/);assert.match(ex,/EXIT REVIEW/);
 assert.match(ex,/Underlying invalidation/);assert.equal(ce.includes(token),false);
});
test('manifest gates Telegram access behind optional host permission',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const m=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));
 assert.deepEqual(m.optional_host_permissions,['https://api.telegram.org/*']);
 assert.equal(m.host_permissions.includes('https://api.telegram.org/*'),false);
 assert.equal(m.permissions.includes('tabs'),false);
});
