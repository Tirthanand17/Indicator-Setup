"""Realized-only paper statistics; unresolved exits are never scored as trades.

No broker calls, real orders, fabricated mark-to-market or profitability proof.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime,date,timedelta
from decimal import Decimal,ROUND_HALF_UP
import sqlite3
from zoneinfo import ZoneInfo


def _rs(value:int)->float:
    return float((Decimal(value)/100).quantize(Decimal('0.01')))


def _pct(paise:int,initial:int)->float:
    return float((100*Decimal(paise)/Decimal(initial)).quantize(Decimal('0.01'),rounding=ROUND_HALF_UP))


def realized_analytics(path:str,now:datetime)->dict:
    """Compute separate account metrics, requiring actual simulated exit quotes.

    Returns are on INITIAL paper capital, not live mark-to-market equity.
    """
    if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('aware analytics date required')
    today=now.astimezone(ZoneInfo('Asia/Kolkata')).date()
    start_week=today-timedelta(days=today.weekday())
    start_month=today.replace(day=1)
    with sqlite3.connect(path,timeout=10) as db:
        accounts=db.execute('SELECT account_id,initial_paise FROM paper_accounts ORDER BY initial_paise').fetchall()
        rows=db.execute('SELECT account_id,entry_at,exit_at,option_kind,status,net_pnl_paise '
                        'FROM paper_positions ORDER BY exit_at,trade_id').fetchall()
    by=defaultdict(list)
    for row in rows:by[row[0]].append(row)
    result=[]
    for account,initial in accounts:
        if initial<=0:raise ValueError('invalid account capital')
        all_rows=by[account]
        closed=[r for r in all_rows if r[4]=='CLOSED' and r[5] is not None and r[2]]
        unresolved=[r for r in all_rows if r[4]!='CLOSED']
        daily=defaultdict(int);by_kind=defaultdict(lambda:[0,0]);hours=defaultdict(int)
        gross_win=gross_loss=0;peak=equity=initial;max_dd=0
        max_win_streak=max_loss_streak=run_win=run_loss=0
        for r in closed:
            pnl=int(r[5]);exit_day=date.fromisoformat(r[2][:10])
            daily[exit_day.isoformat()]+=pnl
            by_kind[r[3]][0]+=1;by_kind[r[3]][1]+=pnl
            hours[r[1][11:13]]+=1
            gross_win+=max(0,pnl);gross_loss+=max(0,-pnl)
            equity+=pnl;peak=max(peak,equity);max_dd=max(max_dd,peak-equity)
            run_win=run_win+1 if pnl>0 else 0;run_loss=run_loss+1 if pnl<0 else 0
            max_win_streak=max(max_win_streak,run_win)
            max_loss_streak=max(max_loss_streak,run_loss)
        current=0;curve=[]
        for day,pnl in sorted(daily.items()):
            current+=pnl
            curve.append({'date':day,'realized_pnl_rs':_rs(pnl),'cumulative_pnl_rs':_rs(current)})
        total=sum(int(r[5]) for r in closed)
        wins=sum(r[5]>0 for r in closed);losses=sum(r[5]<0 for r in closed)
        day_net=sum(v for k,v in daily.items() if k==today.isoformat())
        week_net=sum(v for k,v in daily.items() if start_week<=date.fromisoformat(k)<=today)
        month_net=sum(v for k,v in daily.items() if start_month<=date.fromisoformat(k)<=today)
        result.append({'id':account,'initial_rs':_rs(initial),'closed_trades':len(closed),
            'wins':wins,'losses':losses,'breakeven':len(closed)-wins-losses,
            'unresolved':len(unresolved),'unverifiable':sum(r[4]=='EXIT_UNVERIFIABLE' for r in unresolved),
            'win_rate_pct':round(100*wins/len(closed),2) if closed else None,
            'net_realized_rs':_rs(total),'gross_winning_rs':_rs(gross_win),
            'gross_losing_rs':_rs(gross_loss),'profit_factor':round(gross_win/gross_loss,2) if gross_loss else None,
            'expectancy_rs':_rs(round(total/len(closed))) if closed else None,
            'max_realized_drawdown_rs':_rs(max_dd),
            'longest_win_streak':max_win_streak,'longest_loss_streak':max_loss_streak,
            'day_return_pct_on_initial':_pct(day_net,initial),
            'week_return_pct_on_initial':_pct(week_net,initial),
            'month_return_pct_on_initial':_pct(month_net,initial),
            'total_return_pct_on_initial':_pct(total,initial),
            'pnl_by_option_kind':{k:{'count':v[0],'net_realized_rs':_rs(v[1])} for k,v in by_kind.items()},
            'trades_by_entry_hour':dict(hours),'realized_equity_curve':curve,
            'actual_orders':False,'actual_fills_verified':False,
            'unrealized_pnl_rs':None if unresolved else 0.0})
    return {'mode':'PAPER_ONLY','source':'MODELED_UNVERIFIED_OPTION_QUOTES',
            'as_of_ist':today.isoformat(),'accounts':result,
            'real_money_orders':0,'strategy_profitability_validated':False,
            'performance_basis':'REALIZED_ONLY_EXCLUDES_UNVERIFIABLE'}
