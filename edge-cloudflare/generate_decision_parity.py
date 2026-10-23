"""Pure synthetic Python oracle for JS entry-decision parity. No Kite or orders.

Run: python edge-cloudflare/generate_decision_parity.py
Never bless a failing JS port by silently regenerating fixtures.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
import json
import sys
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'cloud-alerts'))
from cloud_alerts.models import Candle  # noqa: E402
from cloud_alerts.signals import decide  # noqa: E402

IST = ZoneInfo('Asia/Kolkata')
TODAY = datetime(2026, 10, 23, 9, 15, tzinfo=IST)
YESTERDAY = datetime(2026, 10, 22, 9, 15, tzinfo=IST)
NOW = datetime(2026, 10, 23, 10, 45, 20, tzinfo=IST)


def bars(direction: int, minutes: int) -> list[Candle]:
    previous = 75 if minutes == 5 else 25
    current = 18 if minutes == 5 else 6
    output = []
    for first, count, today in ((YESTERDAY, previous, False), (TODAY, current, True)):
        for i in range(count):
            # Wide two-sided historical noise, narrowing into a current-session
            # breakout with a rising Wilder ADX. No chart/broker data involved.
            oscillation = ((i * 17) % 13 - 6) * 0.9
            trend = direction * (max(0, i - (6 if minutes == 5 else 1)) ** 1.22) * (3 if minutes == 5 else 7)
            mid = 22000 + oscillation + (trend if today else 0)
            output.append(Candle(first + timedelta(minutes=i * minutes),
                mid - 0.4, mid + 2, mid - 2, mid, 1300 + i))
    return output


def js_bar(bar: Candle) -> dict:
    return dict(startMs=int(bar.start.timestamp() * 1000), open=bar.open,
        high=bar.high, low=bar.low, close=bar.close, volume=bar.volume)


def run(name: str, series5: list[Candle], series15: list[Candle],
        when: datetime = NOW, **options) -> dict:
    verdict = decide(series5, when, series15, **options)
    expected = asdict(verdict)
    if verdict.candle is not None:
        expected['candle'] = js_bar(verdict.candle)
    return dict(name=name, candles=[js_bar(b) for b in series5],
        confirm15m=[js_bar(b) for b in series15], nowMs=int(when.timestamp() * 1000),
        adxMin=options.get('adx_min', 25), atrBuffer=options.get('atr_buffer', 0.5),
        expected=expected)


def changed(bars_in: list[Candle], index: int, **updates) -> list[Candle]:
    result = list(bars_in)
    result[index] = Candle(**(asdict(result[index]) | updates))
    return result


def mirror(bars_in: list[Candle]) -> list[Candle]:
    return [Candle(b.start, 44000 - b.open, 44000 - b.low,
        44000 - b.high, 44000 - b.close, b.volume) for b in bars_in]


cases = []
for direction, name in ((1, 'uptrend'), (-1, 'downtrend'), (0, 'sideways')):
    b5, b15 = bars(direction, 5), bars(direction, 15)
    cases.append(run(name, b5, b15))
    if direction:
        cases.append(run(name + '_custom_adx', b5, b15, adx_min=15))
        cases.append(run(name + '_wide_stop', b5, b15, adx_min=15, atr_buffer=3.0))

    if direction:
        found = False
        for delta in (0.1, 0.5, 1, 2, 4, 8, 12):
            for buffer in (0, 0.1, 0.25, 0.5):
                previous = b5[-4:-1]
                closing = (max(b.high for b in previous) + delta if direction == 1
                    else min(b.low for b in previous) - delta)
                altered = changed(b5, -1, open=closing - 0.4 * direction,
                    high=closing + 2, low=closing - 2, close=closing)
                outcome = decide(altered, NOW, b15, adx_min=10, atr_buffer=buffer)
                if outcome.status in ('REVIEW_CE', 'REVIEW_PE'):
                    cases.append(run(name + '_qualifying_review', altered, b15,
                        adx_min=10, atr_buffer=buffer))
                    if direction == -1:
                        cases.append(run('uptrend_mirrored_qualifying_review',
                            mirror(altered), mirror(b15), adx_min=10, atr_buffer=buffer))
                    found = True
                    break
            if found: break

five, fifteen = bars(1, 5), bars(1, 15)
cases += [
    run('weekend', five, fifteen, datetime(2026, 10, 24, 10, 45, tzinfo=IST)),
    run('nse_holiday', five, fifteen, datetime(2026, 10, 20, 10, 45, tzinfo=IST)),
    run('unknown_calendar', five, fifteen, datetime(2027, 10, 23, 10, 45, tzinfo=IST)),
    run('before_entry_window', five, fifteen, TODAY + timedelta(minutes=10)),
    run('after_entry_window', five, fifteen, TODAY + timedelta(hours=6)),
    run('short_five_minute_warmup', five[:60], fifteen),
    run('short_fifteen_minute_warmup', five, fifteen[:29]),
    run('off_grid_five', changed(five, -1, start=five[-1].start + timedelta(seconds=1)), fifteen),
    run('off_grid_fifteen', five, changed(fifteen, -1, start=fifteen[-1].start + timedelta(seconds=1))),
    run('missing_open_five', five[:75] + five[76:], fifteen),
    run('missing_open_fifteen', five, fifteen[:25] + fifteen[26:]),
    run('five_gap', five[:83] + five[84:], fifteen),
    run('fifteen_gap', five, fifteen[:28] + fifteen[29:]),
    run('zero_volume', changed(five, -1, volume=0), fifteen),
    run('stale_five', five, fifteen, NOW + timedelta(minutes=3)),
    run('early_unconfirmed_five', five, fifteen, five[-1].start + timedelta(minutes=5, seconds=2)),
    run('future_five', five, fifteen, five[-1].start - timedelta(seconds=1)),
    run('stale_fifteen', five, fifteen, NOW.replace(minute=46)),
    run('stale_fifteen_with_full_warmup', five,
        [Candle(b.start-timedelta(days=1),b.open,b.high,b.low,b.close,b.volume)
         for b in fifteen[:5]] + fifteen[:-2]),
    run('wide_risk', five, fifteen, atr_buffer=5.0),
    run('very_high_adx_min', five, fifteen, adx_min=150),
]

out = HERE / 'decision-parity-fixtures.json'
out.write_text(json.dumps({'source':'SYNTHETIC_PYTHON_SIGNALS_DECIDE',
    'cases':cases}, separators=(',',':')) + '\n', encoding='utf-8')
for case in cases:
    print(case['name'], case['expected']['status'], case['expected']['reason'])
print('wrote', len(cases), 'Python reference cases')
