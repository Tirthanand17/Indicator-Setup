/** Offline-only confidential backup envelope for the signed paper journal.
 * Neither this module nor the Worker exports or uploads user records.
 * NEVER publish a plaintext research archive or put backup keys in GitHub.
 */
import { MAX_ARCHIVE_BYTES, verifyPaperArchive,
  restorePaperArchiveToEmpty } from './paper-archive.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_SIGNED_ARCHIVE_BYTES = MAX_ARCHIVE_BYTES + 4096;
const DOMAIN = 'NIFTY_PAPER_ARCHIVE_SEALED_V1_AES_256_GCM';
const AAD = encoder.encode(DOMAIN);
const error = name => { throw Error(`SEALED_ARCHIVE_${name}`); };
const exactKeys = (obj, keys) => obj && typeof obj === 'object' &&
  !Array.isArray(obj) && Object.keys(obj).sort().join(',') === keys.slice().sort().join(',');

function base64url(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 16_384) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16_384)));
  }
  return btoa(chunks.join('')).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64url(value, maxBytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) ||
      value.length > Math.ceil(maxBytes / 3) * 4 + 4) error('INVALID_CIPHERTEXT_ENCODING');
  let decoded;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    decoded = Uint8Array.from(atob(padded + '='.repeat((4 - padded.length % 4) % 4)),
      char => char.charCodeAt(0));
  } catch { error('INVALID_CIPHERTEXT_ENCODING'); }
  if (decoded.length > maxBytes || base64url(decoded) !== value)
    error('INVALID_CIPHERTEXT_ENCODING');
  return decoded;
}

async function encryptionKey(base64Key) {
  if (typeof base64Key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(base64Key))
    error('INVALID_ENCRYPTION_KEY');
  let raw;
  try { raw = Uint8Array.from(atob(base64Key), char => char.charCodeAt(0)); }
  catch { error('INVALID_ENCRYPTION_KEY'); }
  if (raw.length !== 32 || btoa(String.fromCharCode(...raw)) !== base64Key)
    error('INVALID_ENCRYPTION_KEY');
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally { raw.fill(0); }
}

function checkKeySeparation(archiveSigningSecret, encryptionKeyBase64) {
  if (typeof archiveSigningSecret !== 'string' ||
      archiveSigningSecret === encryptionKeyBase64) error('KEY_SEPARATION_REQUIRED');
}

/** Sign first using paper-archive.mjs, then encrypt this entire valid bundle.
 * The AES-GCM nonce is 96 random bits per export; never pass a caller nonce.
 */
export async function sealSignedPaperArchive({ signedArchive, archiveSigningSecret,
  encryptionKeyBase64 } = {}) {
  checkKeySeparation(archiveSigningSecret, encryptionKeyBase64);
  const snapshot = structuredClone(signedArchive);
  await verifyPaperArchive(snapshot, archiveSigningSecret);
  const plaintext = encoder.encode(JSON.stringify(snapshot));
  if (plaintext.byteLength > MAX_SIGNED_ARCHIVE_BYTES) error('SIZE_LIMIT');
  const key = await encryptionKey(encryptionKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: AAD, tagLength: 128 }, key, plaintext);
  return { format: DOMAIN, schema: 1, algorithm: 'AES-256-GCM',
    iv: base64url(iv), ciphertext: base64url(new Uint8Array(encrypted)) };
}

/** Full GCM authentication and independently signed ledger audit must both
 * succeed before a decrypted accounting document can be trusted.
 */
export async function openSealedPaperArchive({ sealedArchive, archiveSigningSecret,
  encryptionKeyBase64 } = {}) {
  checkKeySeparation(archiveSigningSecret, encryptionKeyBase64);
  if (!exactKeys(sealedArchive, ['format', 'schema', 'algorithm', 'iv', 'ciphertext']) ||
      sealedArchive.format !== DOMAIN || sealedArchive.schema !== 1 ||
      sealedArchive.algorithm !== 'AES-256-GCM') error('INVALID_ENVELOPE');
  const iv = decodeBase64url(sealedArchive.iv, 12);
  if (iv.length !== 12) error('INVALID_IV');
  const ciphertext = decodeBase64url(sealedArchive.ciphertext,
    MAX_SIGNED_ARCHIVE_BYTES + 16);
  if (ciphertext.length < 17) error('INVALID_CIPHERTEXT');
  const key = await encryptionKey(encryptionKeyBase64);
  let payload;
  try {
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv,
      additionalData: AAD, tagLength: 128 }, key, ciphertext);
    payload = JSON.parse(decoder.decode(clear));
  } catch { error('DECRYPT_OR_AUTH_FAILED'); }
  return { signedArchive: structuredClone(payload),
    verified: await verifyPaperArchive(payload, archiveSigningSecret) };
}

/** Restore remains internal and empty-target-only; there is no HTTP route.
 * Existing scheduler, broker token and delivery state are NEVER replaced.
 */
export async function restoreSealedPaperArchiveToEmpty(storage, options) {
  const { signedArchive } = await openSealedPaperArchive(options);
  return restorePaperArchiveToEmpty(storage, signedArchive, options.archiveSigningSecret);
}
