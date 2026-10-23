"""Regenerate synthetic fixtures from the Python reference; no I/O except fixture output.

Run from any directory: python edge-cloudflare/generate_parity.py
Review fixture changes; do not bless a failing implementation by regenerating blindly.
"""
from pathlib import Path
import sys
import json
from datetime import datetime, timedelta, date
from dataclasses import asdict
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'cloud-alerts'))
from cloud_alerts.models import Candle
from cloud_alerts.indicators import compute
from cloud_alerts.paper_charges import estimate_nse_option_leg

cases=[]
for direction in (-1,0,1):
    bars=[]
    for d in (22,23):
        for i in range(60):
            p=22000+direction*((d-22)*100+i*.6)+(i%7)*.1
            bars.append(Candle(datetime(2026,10,d,9,15,tzinfo=ZoneInfo('Asia/Kolkata'))+timedelta(minutes=i*5),p-.4,p+1.3,p-1.9,p,900+i))
    cases.append({'name':str(direction),'candles':[dict(startMs=int(b.start.timestamp()*1000),
        open=b.open,high=b.high,low=b.low,close=b.close,volume=b.volume) for b in bars],
        'expected':asdict(compute(bars))})
fees=[]
for price in ('0.05','100','100.08','141.8864','333.333333','9999.95'):
    for qty in (65,130,195):
        for side in ('BUY','SELL'):
            fees.append({'price':price,'qty':qty,'side':side,'onDate':'2026-10-23',
                'expected':asdict(estimate_nse_option_leg(price,qty,side,on_date=date(2026,10,23)))})
(ROOT/'parity-fixtures.json').write_text(json.dumps({'source':'SYNTHETIC_PYTHON_REFERENCE','indicators':cases,'fees':fees},indent=2)+'\n',encoding='utf-8')
