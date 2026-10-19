'use strict';
const badge = document.querySelector('#badge'), description = document.querySelector('#description');
chrome.runtime.sendMessage({ type:'GET_STATE' }, response => {
  if (chrome.runtime.lastError || !response || response.error) { badge.textContent='Unable to read status'; return; }
  badge.textContent=response.chartOpen ? 'Kite chart detected' : 'WAIT_DATA — Kite chart not detected';
  description.textContent=response.chartOpen ? 'Chart open. Enter manually verified CLOSED five-minute candle values in the dashboard. No automatic price feed is connected.' : 'Open the NIFTY futures chart in Kite. This extension cannot inspect private chart internals or assume a valid quote.';
});
document.querySelector('#open').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
