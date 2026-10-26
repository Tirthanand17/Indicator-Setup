/** No storage/network. Limits are per isolate, not a global abuse/cost guarantee. */
export const INGRESS_POLICY = Object.freeze({
  login: Object.freeze({attempts: 30, concurrent: 4}),
  relay: Object.freeze({attempts: 60, concurrent: 4}),
  dashboard: Object.freeze({attempts: 240, concurrent: 8}),
});
export function createIngressAdmission(clock = Date.now) {
  const buckets = new Map();
  return (category) => {
    const policy = INGRESS_POLICY[category], now = clock();
    if (!policy || !Number.isSafeInteger(now) || now <= 0) return {accepted: false, retryAfter: 60};
    let bucket = buckets.get(category);
    if (!bucket) {bucket = {start: now, count: 0, active: 0}; buckets.set(category, bucket);}
    // Clock rollback never resets a budget. Active work survives window rollover.
    if (now - bucket.start >= 60_000) {bucket.start = now; bucket.count = 0;}
    if (now < bucket.start || bucket.count >= policy.attempts || bucket.active >= policy.concurrent)
      return {accepted: false, retryAfter: Math.max(1, Math.min(60, Math.ceil((bucket.start + 60_000 - now) / 1000)))};
    bucket.count++; bucket.active++;
    let released = false;
    return {accepted: true, release() {if (!released) {released = true; bucket.active--;}}};
  };
}

export const BODY_DEADLINE_MS = 3000;
export async function readBoundedBody(stream, maxBytes, timeoutMs = BODY_DEADLINE_MS) {
  if (!stream) throw Error('MISSING_BODY');
  const reader = stream.getReader(), chunks = []; let length = 0, timer;
  try {
    return await Promise.race([
      (async () => {
        while (true) {
          const {done, value} = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > maxBytes) throw Error('BODY_TOO_LARGE');
          chunks.push(value);
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
        return bytes;
      })(),
      new Promise((_, reject) => {timer = setTimeout(() => reject(Error('BODY_DEADLINE')), timeoutMs);}),
    ]);
  } finally {
    clearTimeout(timer);
    // Never await an untrusted stream's cancellation promise: it too may stall.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
