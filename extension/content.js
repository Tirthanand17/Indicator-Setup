/* Presence-only. NEVER read location.hash: Kite's iframe URL may include session secrets.
 * Never access cookies, localStorage, broker APIs, page internals, quotes or charts.
 * Market indicators are NOT available as a validated closed-candle feed here.
 */
(() => {
  'use strict';
  const path = window.location.pathname;
  const isChart = path.startsWith('/markets/ext/chart/') || path.startsWith('/static/chart/tradingview/');
  if (!isChart) return;
  const segments = path.split('/');
  const candidate = segments.length >= 2 ? segments[segments.length - 2] : '';
  const symbol = /^NIFTY\d{2}[A-Z]{3}FUT$/.test(candidate) ? candidate : null;
  const heartbeat = () => {
    try {
      chrome.runtime.sendMessage({ type: 'CHART_HEARTBEAT', symbol, chartFrame: path.startsWith('/static/chart/') }, () => void chrome.runtime.lastError);
    } catch { /* Extension may be reloaded. */ }
  };
  heartbeat();
  setInterval(heartbeat, 12000);
})();
