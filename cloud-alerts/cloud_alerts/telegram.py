"""Outbound notification only. Sends no broker credentials or account data."""
from __future__ import annotations
from .models import Decision,OptionQuote
import requests


def format_review(decision:Decision,quote:OptionQuote,source:str='KITE HISTORICAL REST')->str:
    if decision.status not in ('REVIEW_CE','REVIEW_PE') or decision.candle is None or decision.indicators is None:
        raise ValueError('not an eligible review')
    b=decision.candle;i=decision.indicators;c=quote.contract
    return '\n'.join([
      'NIFTY PAPER ALERT — POTENTIAL BUY '+c.kind+' (REVIEW ONLY)',
      f'Futures confirmed candle: {b.start:%Y-%m-%d %H:%M} IST (5m)',
      f'NIFTY futures close: {b.close:.2f} | Session VWAP: {i.vwap:.2f}',
      f'EMA9: {i.ema9:.2f} | EMA21: {i.ema21:.2f}',
      f'+DI: {i.plus_di:.1f} | -DI: {i.minus_di:.1f} | ADX: {i.adx:.1f} | ATR: {i.atr:.2f}',
      f'Listed option: NFO:{c.symbol} | expiry {c.expiry} | lot size {c.lot_size}',
      f'Bid {quote.bid:.2f} / Ask {quote.ask:.2f} | top depth {quote.bid_quantity}/{quote.ask_quantity}',
      f'Underlying invalidation: {decision.stop_underlying:.2f} | illustrative target: {decision.target_underlying:.2f}',
      f'Source: {source}. Exchange quote time {quote.updated:%H:%M:%S} IST.',
      'NOT A BUY ORDER. Review current premium, IV, strike, position size, stop and all charges.',
      'This bot NEVER sends orders. Quoted ASK can change before you act.'
    ])

class Telegram:
    def __init__(self,bot_token:str,chat_id:str):
        if not bot_token or not chat_id:raise ValueError('Telegram settings missing')
        self.bot_token=bot_token
        self.chat_id=chat_id
    def send(self,text:str)->None:
        # Keep token out of logs/exceptions. It is present only in HTTPS Bot API URL.
        try:
            response=requests.post('https://api.telegram.org/bot'+self.bot_token+'/sendMessage',
                json={'chat_id':self.chat_id,'text':text[:3900],'disable_notification':False,'protect_content':True},
                timeout=7,allow_redirects=False)
            if response.status_code!=200:raise RuntimeError('Telegram returned non-200 status')
            body=response.json()
            if body.get('ok') is not True:raise RuntimeError('Telegram rejected the message')
        except Exception:
            raise RuntimeError('Telegram delivery failed; check outbound network and bot settings') from None
