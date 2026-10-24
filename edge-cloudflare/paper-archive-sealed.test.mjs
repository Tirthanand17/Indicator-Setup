import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { newPaperLedger, enterPaperBasket } from './paper-ledger.mjs';
import { makePaperArchive } from './paper-archive.mjs';
import { sealSignedPaperArchive, openSealedPaperArchive,
  restoreSealedPaperArchiveToEmpty } from './paper-archive-sealed.mjs';

const AT = Date.parse('2026-10-23T04:30:00Z');
const SIGNING_SECRET = 'offline-archive-hmac-separate-from-encryption-secret-001';
const aes = () => randomBytes(32).toString('base64');
const ledgerFixture = () => enterPaperBasket(newPaperLedger(AT), {
  signalId: 'confidential-archive-paper-signal-001', nowMs: AT,
  quote: { contract: { symbol: 'NIFTY26OCT23000PE', kind: 'PE',
    expiry: '2026-10-29', token: 23456, lotSize: 65 },
  bid: 100, ask: 100.5, bidQuantity: 650, askQuantity: 650,
  updatedAtMs: AT - 1000 },
}).ledger;
const archive = async ledger => makePaperArchive({ ledger, secret: SIGNING_SECRET,
  createdAtMs: ledger.lastMutationAtMs + 1000 });
const seal = (signedArchive, encryptionKeyBase64) => sealSignedPaperArchive({
  signedArchive, archiveSigningSecret: SIGNING_SECRET, encryptionKeyBase64 });
const open = (sealedArchive, encryptionKeyBase64) => openSealedPaperArchive({
  sealedArchive, archiveSigningSecret: SIGNING_SECRET, encryptionKeyBase64 });

function emptyStore() {
  const rows = new Map();
  return { rows, async transaction(callback) {
    const staged = new Map(structuredClone([...rows]));
    const txn = { get: async k => staged.get(k),
      put: async (k,v) => staged.set(k,structuredClone(v)) };
    const result = await callback(txn);
    rows.clear();
    for(const [key,value] of staged)rows.set(key,value);
    return result;
  } };
}

test('AES-256-GCM export hides signed archive, source alerts and credentials', async()=>{
  const key=aes(), original=await archive(ledgerFixture());
  const first=await seal(original,key), second=await seal(original,key);
  assert.equal(first.algorithm,'AES-256-GCM');
  assert.equal(first.schema,1);
  assert.match(first.iv,/^[A-Za-z0-9_-]{16}$/);
  assert.notEqual(first.iv,second.iv);
  assert.notEqual(first.ciphertext,second.ciphertext);
  const encoded=JSON.stringify(first);
  for(const leak of ['confidential-archive-paper-signal-001',
    'NIFTY26OCT23000PE','outbox','accounts',SIGNING_SECRET,key])
    assert.equal(encoded.includes(leak),false);
  const recovered=await open(first,key);
  assert.deepEqual(recovered.signedArchive,original);
  assert.equal(recovered.verified.ledger.positions.length,2);
  assert.equal(recovered.verified.ledger.outbox.length,2);
});

test('tampered encrypted backups, wrong key, wrong signing key and malformed envelope fail',async()=>{
  const key=aes(), original=await archive(ledgerFixture());
  const sealed=await seal(original,key);
  await assert.rejects(()=>open(sealed,aes()));
  await assert.rejects(()=>openSealedPaperArchive({sealedArchive:sealed,
    archiveSigningSecret:SIGNING_SECRET+'-wrong',encryptionKeyBase64:key}));
  await assert.rejects(()=>open({...sealed,iv:'A'.repeat(16)},key));
  await assert.rejects(()=>open({...sealed,ciphertext:
    sealed.ciphertext.slice(0,-1)+(sealed.ciphertext.endsWith('A')?'B':'A')},key));
  await assert.rejects(()=>open({...sealed,ciphertext:'!!!'},key));
  await assert.rejects(()=>open({...sealed,schema:2},key));
  await assert.rejects(()=>open({...sealed,accidentalPlaintext:'secret'},key));
  await assert.rejects(()=>seal({...original,auth:{...original.auth,tag:'A'.repeat(43)}},key));
  await assert.rejects(()=>seal(original,'bad-key'));
  await assert.rejects(()=>sealSignedPaperArchive({signedArchive:original,
    archiveSigningSecret:key,encryptionKeyBase64:key}),/KEY_SEPARATION_REQUIRED/);
});

test('encrypted restore is only permitted on a totally empty isolated ledger store',async()=>{
  const original=ledgerFixture(),key=aes(),signed=await archive(original);
  const sealed=await seal(signed,key), target=emptyStore();
  const result=await restoreSealedPaperArchiveToEmpty(target,{
    sealedArchive:sealed,archiveSigningSecret:SIGNING_SECRET,encryptionKeyBase64:key});
  assert.equal(result.status,'OFFLINE_RESTORED_TO_EMPTY_STORAGE');
  assert.deepEqual(target.rows.get('paper-ledger-v1'),original);
  assert.equal(target.rows.has('scheduler-v1'),false);
  assert.equal(target.rows.has('daily-token-v1'),false);
  assert.equal(target.rows.has('paper-delivery-v1'),false);
  const before=structuredClone([...target.rows]);
  await assert.rejects(()=>restoreSealedPaperArchiveToEmpty(target,{
    sealedArchive:sealed,archiveSigningSecret:SIGNING_SECRET,encryptionKeyBase64:key}),
  /TARGET_NOT_EMPTY/);
  assert.deepEqual([...target.rows],before);
  const empty=emptyStore();
  await assert.rejects(()=>restoreSealedPaperArchiveToEmpty(empty,{
    sealedArchive:sealed,archiveSigningSecret:SIGNING_SECRET,
    encryptionKeyBase64:aes()}));
  assert.equal(empty.rows.size,0);
});

test('chunked base64url encoding supports larger legitimate research archives',async()=>{
  const ledger=ledgerFixture();
  for(let i=0;i<220;i++)ledger.rejections.push({
    accountId:i%2?'PAPER_50K':'PAPER_100K',
    signalId:`large-archive-rejection-${i}`,reason:'SYNTHETIC_REJECTION',atMs:AT,
  });
  const key=aes(),signed=await archive(ledger);
  assert.ok(JSON.stringify(signed).length>16_384);
  const sealed=await seal(signed,key);
  assert.deepEqual((await open(sealed,key)).verified.ledger.rejections,
    ledger.rejections);
});
