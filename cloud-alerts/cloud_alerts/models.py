"""Pure data contracts. Exchange timestamps are always timezone-aware IST."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
import math

@dataclass(frozen=True)
class Candle:
    start: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int

    def validate(self) -> None:
        if self.start.tzinfo is None or self.start.utcoffset() is None:
            raise ValueError('candle timestamp is timezone naive')
        if not all(math.isfinite(v) and v > 0 for v in (self.open,self.high,self.low,self.close)):
            raise ValueError('invalid OHLC')
        if not self.high >= max(self.open,self.close,self.low) or not self.low <= min(self.open,self.close,self.high):
            raise ValueError('inconsistent OHLC')
        if self.volume < 0:
            raise ValueError('negative volume')

@dataclass(frozen=True)
class Indicators:
    vwap: float
    ema9: float
    ema21: float
    plus_di: float
    minus_di: float
    adx: float
    previous_adx: float
    atr: float

@dataclass(frozen=True)
class Decision:
    status: str
    reason: str
    candle: Candle | None = None
    indicators: Indicators | None = None
    stop_underlying: float | None = None
    target_underlying: float | None = None

@dataclass(frozen=True)
class Contract:
    token: int
    symbol: str
    expiry: str
    lot_size: int
    strike: float = 0
    kind: str = 'FUT'

@dataclass(frozen=True)
class OptionQuote:
    contract: Contract
    bid: float
    ask: float
    bid_quantity: int
    ask_quantity: int
    updated: datetime
