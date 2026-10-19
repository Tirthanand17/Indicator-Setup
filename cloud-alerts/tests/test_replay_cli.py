from dataclasses import asdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import json
from cloud_alerts.replay_cli import run_cli

IST=ZoneInfo('Asia/Kolkata')

def dataset(tmp_path):
    def rows(minutes,n):
        result=[]
        for day in [12,13,14,15,16,19]:
            for i in range(n):
                stamp=datetime(2026,10,day,9,15,tzinfo=IST)+timedelta(minutes=minutes*i)
                p=22000+day*10+i
                result.append(dict(start=stamp.isoformat(),open=p,high=p+1,low=p-1,close=p,volume=1000))
        return result
    data=dict(schema='nifty-replay-v1',candles_5m=rows(5,45),candles_15m=rows(15,15))
    path=tmp_path/'synthetic.json'
    path.write_text(json.dumps(data))
    return path,data

def args(path):
    return ['--input',str(path),'--start','2026-10-19T09:30:00+05:30',
            '--end','2026-10-19T12:30:00+05:30']

def test_offline_summary_never_claims_option_pnl(tmp_path,capsys):
    path,_=dataset(tmp_path)
    assert run_cli(args(path))==0
    report=json.loads(capsys.readouterr().out)
    assert report['real_orders'] is False
    assert report['historical_option_quotes_verified'] is False
    assert report['historical_decisions']>1

def test_unexpected_token_field_rejected_without_echo(tmp_path,capsys):
    path,data=dataset(tmp_path)
    data['access_token']='do_not_print_fake_token'
    path.write_text(json.dumps(data))
    assert run_cli(args(path))==2
    assert 'do_not_print_fake_token' not in capsys.readouterr().out

def test_string_volume_rejected(tmp_path,capsys):
    path,data=dataset(tmp_path)
    data['candles_5m'][0]['volume']='1000'
    path.write_text(json.dumps(data))
    assert run_cli(args(path))==2
    assert 'INVALID_REPLAY_DATA' in capsys.readouterr().out
