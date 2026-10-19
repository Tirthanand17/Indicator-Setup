"""Chronological option-paper walk-forward splits with session-day embargo.

This is research plumbing, not a strategy optimizer or proof of profitability.
Historical futures candles alone cannot generate independently verified option
BID/ASK outcomes, so any results remain plainly labeled hypothetical.
"""
from __future__ import annotations
from .evaluation import PaperQuotePair, Costs, EvidenceError, score_pair, IST


def walk_forward_windows(records: list[PaperQuotePair], costs: Costs, *,
                         train_sessions: int = 10, test_sessions: int = 3,
                         embargo_sessions: int = 1, step_sessions: int | None = None) -> dict:
    """Construct completed chronological folds without leaking test sessions into training.

    Each distinct IST session belongs wholly to TRAIN, EMBARGO, or TEST within
    its fold. Reuse of an earlier fold's TEST as a *later* fold's TRAIN is allowed
    by chronological walk-forward convention, but future rows never enter past
    training. Costs apply to ASK-entry/BID-exit hypothetical observations only.
    """
    sizes = (train_sessions, test_sessions, embargo_sessions)
    if any(type(v) is not int for v in sizes) or train_sessions < 2 or test_sessions < 1 or embargo_sessions < 1:
        raise EvidenceError('train/test/embargo sessions must be positive integers; train >=2')
    step = test_sessions if step_sessions is None else step_sessions
    if type(step) is not int or step < 1:
        raise EvidenceError('walk-forward step sessions must be positive')
    if len({r.event_id for r in records}) != len(records):
        raise EvidenceError('duplicate event id across paper evidence')
    scored = []
    for r in records:
        evidence = score_pair(r, costs)
        day = r.signal_entry_at.astimezone(IST).date()
        scored.append((day, evidence))
    sessions = sorted({day for day,_ in scored})
    minimum = train_sessions + embargo_sessions + test_sessions
    folds = []
    for start in range(0, len(sessions)-minimum+1, step):
        train = sessions[start:start+train_sessions]
        gap = sessions[start+train_sessions:start+train_sessions+embargo_sessions]
        test = sessions[start+train_sessions+embargo_sessions:start+minimum]
        train_set = set(train)
        test_set = set(test)
        # Embargo days intentionally never enter metrics or training.
        train_rows = [r for d,r in scored if d in train_set]
        test_rows = [r for d,r in scored if d in test_set]
        if not (train[-1] < gap[0] < test[0]) or train_set & test_set:
            raise EvidenceError('train/embargo/test session overlap detected')
        folds.append({
            'train_first':train[0].isoformat(), 'train_last':train[-1].isoformat(),
            'embargo_first':gap[0].isoformat(), 'embargo_last':gap[-1].isoformat(),
            'test_first':test[0].isoformat(), 'test_last':test[-1].isoformat(),
            'train_quote_pairs':len(train_rows), 'test_quote_pairs':len(test_rows),
            'test_hypothetical_net_rs':round(sum(r['net_rs'] for r in test_rows),2),
            'test_unverified_quote_pairs':sum(r['source']!='CAPTURED_KITE_QUOTE' for r in test_rows),
            'actual_fills_proven':False,
            'independent_source_audit_complete':False,
        })
    return {'status':'OFFLINE_PAPER_SPLITS_ONLY' if folds else 'INSUFFICIENT_SESSION_DAYS',
            'session_days_available':len(sessions),
            'required_minimum_session_days':minimum,
            'fold_count':len(folds), 'folds':folds,
            'strategy_parameters_fitted':False,
            'out_of_sample_trading_edge_proven':False,
            'real_orders_placed':False}
