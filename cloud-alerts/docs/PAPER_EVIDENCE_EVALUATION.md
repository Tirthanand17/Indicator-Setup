# Option-level paper evidence: conservative after-cost evaluation

**Prototype only. 2026-10-19.** This is a pure data-quality and arithmetic module; there are **no actual broker fills, historical option depth archives or verified strategy win-rate measurements**. It does not connect to Kite, Telegram or order services.

## Inputs

[`cloud_alerts/evaluation.py`](../cloud_alerts/evaluation.py) requires one independently captured **pair** of post-signal option quotes for entry and exit, including:

- a non-duplicate event ID, listed NIFTY CE/PE contract and expiry;
- **timezone-aware** signal and quote timestamps for both entry and exit; quote observations must occur at/after each signal and within **20 seconds**;
- top-of-book BID/ASK at entry and exit with available quantity sufficient for the hypothetical lots; both snapshots must have reasonable spread (default **<=2%**);
- full instrument lot size, number of lots, and an explicit cost model with **nonzero round-trip fees/taxes** and bounded slippage on **both** legs;
- an explicitly labeled provenance category, which alone is **not a verified data-origin attestation**.

The module rejects crossed/inverted quotes, invalid dates and weekends, expired contracts, non-causal/over-delayed timestamps, insufficent depth, duplicate IDs and invalid prices. **NSE market holidays still require an independently reviewed exchange calendar**, and real backtesting requires archived option quote data, not just futures historical candles.

## Calculations and limits

- Paper-entry reference = quoted **ASK**, pessimistically increased by stated slippage. Paper-exit reference = quoted **BID**, pessimistically decreased by stated slippage.
- Gross = `(exit_bid - entry_ask) * lots * lot_size`; net deducts entry/exit slippage and caller-provided roundtrip charges. Zero cost assumptions are forbidden. This is a reference estimate, **not** an executed fill.
- The summary includes after-cost paper win rate, gross/net reference P&L, and maximum cumulative paper drawdown with explicit provenance and reliability caveats.
- `INSUFFICIENT_EVIDENCE` until at least **30 paired observations and 5 trading dates**; `UNVERIFIED_SOURCE` if any source tag is synthetic/unknown; even `PAPER_SAMPLE_REVIEW_UNAUDITED` does **not** certify Kite capture, real fills or profitable trading.
- No quote data files, credentials or trade records are bundled into the public GitHub repository. This design should later read an approved private capture ledger and independently reconcile its timestamps with Kite. A caller-provided tag alone cannot prove provenance.

## Offline verification

```bash
python -m pytest -q
```

The complete project has **116/116 passing synthetic/offline tests** as of this continuation. The evidence evaluator's new tests validate timing, option expiry, spread/depth, slippage/fees and small-sample safeguards. **No strategy accuracy result is inferred from these test fixtures.**

## Work still needed

1. Acquire and store real option BID/ASK observations securely outside the public repository, with independently timestamped post-signal snapshots and data lineage; retain only necessary market data, no holdings or order information.
2. Use a genuine exchange holiday calendar, fees/taxes configuration appropriate to the instrument and account, and quote reconstruction that does not leak future candles/quotes.
3. Build chronological walk-forward splits and a locked out-of-sample reporting protocol. Record missed signals, alert latency, and false-positive alert rate across **five or more** live paper sessions.
4. Never promote to real-money recommendations based only on synthetic unit tests or an unverified paper win rate.
