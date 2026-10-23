import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, webcrypto } from "node:crypto";
import worker, { nextExpiryUtc, scheduledPhase } from "../src/index.mjs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MockDB {
  constructor() { this.nonces = new Set(); this.token = null; this.heartbeat = null; this.fail = false; }
  prepare(sql) {
    if (this.fail) throw new Error("synthetic DB outage");
    return { bind: (...args) => ({ run: async () => {
      if (sql.startsWith("INSERT INTO relay_nonces")) {
        if (this.nonces.has(args[0])) return {meta: {changes: 0}};
        this.nonces.add(args[0]); return {meta: {changes: 1}};
      }
      if (sql.startsWith("INSERT INTO token_vault")) {
        if (this.token && args[2] <= this.token.ts) return {meta: {changes: 0}};
        this.token = {iv:args[0],cipher:args[1],ts:args[2],expires:args[3]};
        return {meta: {changes: 1}};
      }
      if (sql.startsWith("INSERT INTO edge_heartbeat")) {
        this.heartbeat = {time:args[0],phase:args[1]};
        return {meta: {changes: 1}};
      }
      if (sql.startsWith("DELETE FROM relay_nonces")) return {meta: {changes: 0}};
      throw new Error("Unexpected SQL");
    }}) };
  }
}
const HMAC_KEY = "synthetic-only-hmac-key-32bytes-never-prod";
const AES_KEY = randomBytes(32).toString("base64");
const API_KEY = "test_api_key_never_real";
function env() {
  return {DB:new MockDB(), RELAY_HMAC_KEY:HMAC_KEY, EDGE_AES_KEY:AES_KEY,
    KITE_API_KEY:API_KEY, TOKEN_RELAY_ENABLED:"true"};
}
let nonceSeq = 0;
function signedBody(e, opts={}) {
  const at = opts.at ?? Math.floor(Date.now()/1000);
  const nonce = opts.nonce || (++nonceSeq).toString(16).padStart(40, "0");
  const body = JSON.stringify({
    api_key: opts.apiKey || API_KEY,
    access_token: opts.token || "synthetic_zerodha_access_token_1234_NEVER_REAL"
  });
  const hex = createHmac("sha256",e.RELAY_HMAC_KEY)
    .update([at,nonce,body].join("\n")).digest("hex");
  const req = new Request("https://indicator.example.test/internal/token",{
    method:"POST",headers:{"content-type":"application/json",
      "X-Relay-Timestamp":String(at),"X-Relay-Nonce":nonce,
      "X-Relay-Signature":opts.signature || hex},
    body:body
  });
  return {req,body,nonce};
}
async function send(e,opts={}){return worker.fetch(signedBody(e,opts).req,e);}
test("health never claims real trades or Kite connectivity",async()=>{
  const r=await worker.fetch(new Request("https://test/healthz"),{});
  assert.equal(r.status,200);
  const b=await r.json();assert.equal(b.status,"UP");
  assert.equal(b.paper_trading_enabled,false);assert.equal(b.live_data,false);
  assert.equal(b.broker_orders,false);assert.equal(r.headers.get("cache-control"),"no-store");
});
test("disabled relay fails closed even with other credentials",async()=>{
  const e=env();e.TOKEN_RELAY_ENABLED="false";
  assert.equal((await send(e)).status,503);assert.equal(e.DB.token,null);
});
test("missing AES secret cannot accept signed token",async()=>{
  const e=env();delete e.EDGE_AES_KEY;
  assert.equal((await send(e)).status,503);assert.equal(e.DB.token,null);
});
test("exact Python HMAC payload gets accepted, token stored encrypted",async()=>{
  const e=env();const {req,body}=signedBody(e);
  const r=await worker.fetch(req,e);assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{status:"TOKEN_ACCEPTED"});
  assert.ok(e.DB.token && e.DB.token.iv && e.DB.token.cipher);
  assert.ok(!JSON.stringify(e.DB.token).includes(JSON.parse(body).access_token));
  assert.equal(r.headers.get("cache-control"),"no-store");
});
test("reusing same valid nonce fails without changing saved token",async()=>{
  const e=env();const {req,nonce}=signedBody(e);
  assert.equal((await worker.fetch(req,e)).status,200);
  const before=structuredClone(e.DB.token);
  assert.equal((await send(e,{nonce})).status,409);
  assert.deepEqual(e.DB.token,before);
});
test("signed older timestamp cannot replace newer token",async()=>{
  const e=env(),at=Math.floor(Date.now()/1000);
  assert.equal((await send(e,{at:at+15})).status,200);
  const before=structuredClone(e.DB.token);
  assert.equal((await send(e,{at:at-10,token:"synthetic_old_stale_token_987654321"})).status,409);
  assert.deepEqual(e.DB.token,before);
});
test("reject incorrect API key even with authentic signature",async()=>{
  const e=env();assert.equal((await send(e,{apiKey:"wrong"})).status,400);
  assert.equal(e.DB.token,null);
});
test("invalid signature, date and nonce cannot store tokens",async()=>{
  const e=env();assert.equal((await send(e,{signature:"0".repeat(64)})).status,401);
  assert.equal((await send(e,{at:Math.floor(Date.now()/1000)-130})).status,401);
  const req=signedBody(e).req;req.headers.set("X-Relay-Nonce","invalid!");
  assert.equal((await worker.fetch(req,e)).status,401);
  assert.equal(e.DB.token,null);
});
test("reject invalid crypto key without echoing tokens",async()=>{
  const e=env();e.EDGE_AES_KEY="bad";const r=await send(e);
  assert.equal(r.status,503);
  assert.equal(e.DB.token,null);
  assert.ok(!(await r.text()).includes("synthetic_zerodha_access"));
});
test("D1 outage cannot be called success and no order sent",async()=>{
  const e=env();e.DB.fail=true;
  const r=await send(e);assert.equal(r.status,503);
  assert.equal(r.headers.get("cache-control"),"no-store");
});
test("cron stores inert heartbeat without Kite Telegram or fetch",async()=>{
  const e={DB:new MockDB()};
  const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error("network was called")};
  try{
    await worker.scheduled({scheduledTime:Date.UTC(2026,9,23,5,0)},e);
    assert.equal(e.DB.heartbeat.phase,"MARKET_TIME_UNVERIFIED_CALENDAR");
    assert.equal(e.DB.token,null);
  }finally{globalThis.fetch=oldFetch;}
});
test("calendar guard never mistakes weekend for market",()=>{
  assert.equal(scheduledPhase(Date.UTC(2026,9,24,5,0)),"OUTSIDE_TIME_WINDOW");
  assert.equal(scheduledPhase(Date.UTC(2026,9,23,2,0)),"OUTSIDE_TIME_WINDOW");
});
test("IST 6am token boundary UTC safe",()=>{
  const before=Date.UTC(2026,9,23,0,29,59),after=Date.UTC(2026,9,23,0,30);
  assert.equal(nextExpiryUtc(before),after);
  assert.equal(nextExpiryUtc(after),Date.UTC(2026,9,24,0,30));
});
test("unrecognized paths give neutral 404 with no state",async()=>{
  const r=await worker.fetch(new Request("https://test/private/dashboard"),env());
  assert.equal(r.status,404);
});
test("POST oversized content-length blocked before crypto",async()=>{
  const e=env();const {req}=signedBody(e);
  req.headers.set("content-length","8000");
  assert.equal((await worker.fetch(req,e)).status,413);
  assert.equal(e.DB.nonces.size,0);
});
