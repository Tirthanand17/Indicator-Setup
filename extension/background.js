/* Browser-only, no fetch/XHR/WebSocket, no broker order actions, no account access. */
'use strict';
importScripts('engine.js');
const MAX_LOG = 150;
// Embedded PNG supplied as a data URL; no remote image or Web Store dependency.
const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA6ElEQVR42mMUVLb4zzCAgIlhgMGAO4CFkAJ2y2CKLfl5fC1OOUZcaYAaFhPjECZ6WY7LXCZ6WY7L/MGVC2jhe4seQ7yhQNMQgFmOzRF0jwJcjmCil4UnSs7TzwH4gpzmDsBmOS7f0yUN4LOc6g4gNt4pcgCurEVKvJPtAHTL8eVzYnxPkgNw+ZASy4lqD5AatKRYTjAEcFl+ouQ8yRaR7ABcQYtsMYyNTpMCUFpE6LUhsiOo5WP01hETMfFJbctJygW0tBzDAfhar7RqnA6+jgmtQwHdfCZSOxLU7hcwEuqcDljPaMR0TgF/Pl42IevvlQAAAABJRU5ErkJggg==';
const configGet = async () => (await chrome.storage.local.get({ armed: false })).armed === true;
async function chartState() {
  const { chartSeenAt = 0, chartSymbol = null } = await chrome.storage.session.get(['chartSeenAt', 'chartSymbol']);
  // Chrome host permission allows discovery of the chart tab without reading page content.
  // This is presence ONLY: no indicator readings, tokens, cookies or market quotes.
  let detected = false;
  let detectedSymbol = null;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://kite.zerodha.com/markets/ext/chart/*' });
    for (const tab of tabs) {
      if (!tab.url) continue;
      const path = new URL(tab.url).pathname; // DO NOT read URL hash or iframe session tokens
      if (!path.startsWith('/markets/ext/chart/')) continue;
      detected = true;
      const parts = path.split('/');
      const value = parts[parts.length - 2];
      if (/^NIFTY\\d{2}[A-Z]{3}FUT$/.test(value)) detectedSymbol = value;
    }
  } catch { /* Older Chrome or disallowed tab enumeration; rely on heartbeat. */ }
  return {
    chartOpen: detected || Date.now() - chartSeenAt < 35000,
    chartSeenAt: detected ? Date.now() : chartSeenAt,
    chartSymbol: detectedSymbol || chartSymbol
  };
}
async function addLog(entry) {
  const { logs = [] } = await chrome.storage.local.get('logs');
  const updated = [entry, ...logs].slice(0, MAX_LOG);
  await chrome.storage.local.set({ logs: updated, lastResult: entry });
}
async function notify(title, message, dedupeKey) {
  const { sentKeys = [] } = await chrome.storage.local.get('sentKeys');
  if (sentKeys.includes(dedupeKey)) return { delivered: false, reason: 'duplicate' };
  // Reserve first to avoid double notifications under concurrent user clicks.
  await chrome.storage.local.set({ sentKeys: [...sentKeys, dedupeKey].slice(-100) });
  await chrome.notifications.create(dedupeKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120), {
    type: 'basic', iconUrl: ICON, title, message, priority: 1
  });
  return { delivered: true };
}
function safeSender(sender) {
  return sender && sender.id === chrome.runtime.id && sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message.type !== 'string') return { error: 'invalid message' };
    if (message.type === 'CHART_HEARTBEAT') {
      if (!sender.url || !sender.url.startsWith('https://kite.zerodha.com/')) return { error: 'unauthorized source' };
      const symbol = /^NIFTY\d{2}[A-Z]{3}FUT$/.test(message.symbol || '') ? message.symbol : null;
      const payload = { chartSeenAt: Date.now() };
      if (symbol) payload.chartSymbol = symbol;
      await chrome.storage.session.set(payload);
      return { ok: true };
    }
    if (!safeSender(sender)) return { error: 'extension UI only' };
    if (message.type === 'GET_STATE') {
      const state = await chartState();
      const data = await chrome.storage.local.get({ armed: false, logs: [], lastResult: null, position: null });
      return { ...state, ...data };
    }
    if (message.type === 'SET_ARMED') {
      await chrome.storage.local.set({ armed: message.armed === true });
      return { armed: message.armed === true };
    }
    if (message.type === 'TEST_NOTICE') {
      // Test notification is explicitly user-triggered and labeled as such.
      await chrome.notifications.create('test_' + Date.now(), { type:'basic', iconUrl:ICON,
        title:'TEST — NIFTY Paper Alerts', message:'Notification channel works. This is NOT a live trade signal.' });
      return { ok: true };
    }
    if (message.type === 'SUBMIT_CANDLE') {
      const state = await chartState();
      const x = { ...(message.observation || {}), chartOpen: state.chartOpen };
      const result = SignalEngine.analyse(x);
      const status = result.status;
      const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), candleEnd: x.candleEnd || null, symbol: x.symbol || null, status, reasons: result.reasons, source: 'MANUAL_VERIFIED_CANDLE' };
      await addLog(entry);
      let notification = { delivered: false, reason: 'not armed or no actionable candidate' };
      if (result.notify && await configGet()) {
        const direction = status === 'REVIEW_CE' ? 'CE' : 'PE';
        notification = await notify('Potential ' + direction + ' — REVIEW ONLY', 'Manually confirmed 5m input aligned. Check live option premium and risk; NO order placed.', [x.symbol, x.candleEnd, direction].join('_'));
      }
      return { result, notification, chart: state };
    }
    if (message.type === 'SET_POSITION') {
      const p = message.position || {};
      const entry = Number(p.entry), stop = Number(p.stop), target = Number(p.target);
      if (!['CE','PE'].includes(p.direction) || !(entry > 0 && stop > 0 && stop < entry && target > entry)) return { error: 'Bought-option position requires 0 < stop < entry < target' };
      const position = { direction: p.direction, entry, stop, target, id: crypto.randomUUID() };
      await chrome.storage.local.set({ position });
      return { position };
    }
    if (message.type === 'CLEAR_POSITION') {
      await chrome.storage.local.remove('position');
      return { ok: true };
    }
    if (message.type === 'CHECK_EXIT') {
      const { position = null } = await chrome.storage.local.get('position');
      const result = SignalEngine.checkExit(position, message.bid);
      let notification = { delivered: false, reason: 'not armed or no exit signal' };
      if (result.notify && await configGet()) notification = await notify('Paper ' + position.direction + ' — ' + result.status, 'Manually entered option BID hit planned level. Review/exit manually. No order placed.', 'exit_' + position.id);
      const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), source: 'MANUAL_OPTION_BID', status: result.status, reasons: [result.reason || 'No stop/target hit'] };
      await addLog(entry);
      return { result, notification };
    }
    return { error: 'unknown message' };
  })().then(sendResponse).catch(err => sendResponse({ error: String(err && err.message || err) }));
  return true;
});
chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
