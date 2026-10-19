"""Operator-invoked cloud Telegram channel probe; never a market signal.

Offline check is the default; a network send needs TWO explicit CLI flags.
No broker credential, token relay, trade or order API is imported here.
Telegram API success does NOT prove the message reached a physical phone.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from collections.abc import Mapping

from .telegram import Telegram

TEST_MESSAGE = (
    'TEST ONLY — NIFTY cloud paper-alert Telegram channel.\n'
    'This is NOT a market signal, BUY, SELL, order, or option position.\n'
    'Confirm manually that this message appears on your phone.'
)


def validate_channel(env: Mapping[str, str]) -> tuple[str, ...]:
    """Return sanitized codes, never credentials or the chat identifier."""
    blockers: list[str] = []
    if not re.fullmatch(r'[0-9]{6,16}:[A-Za-z0-9_-]{30,100}', env.get('TELEGRAM_BOT_TOKEN', '')):
        blockers.append('TELEGRAM_BOT_CONFIG_INVALID')
    if not re.fullmatch(r'-?[1-9][0-9]{4,19}', env.get('TELEGRAM_CHAT_ID', '')):
        blockers.append('TELEGRAM_CHAT_CONFIG_INVALID')
    return tuple(blockers)


def run(argv: list[str] | None = None, *, env: Mapping[str, str] | None = None,
        telegram_type: type[Telegram] = Telegram) -> int:
    parser = argparse.ArgumentParser(description='Privacy-safe Telegram cloud TEST (no trading)')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check-only', action='store_true', help='No network calls')
    group.add_argument('--send-test', action='store_true', help='Explicit TEST message')
    parser.add_argument('--confirm-send', action='store_true',
                        help='Required for a real Telegram API request')
    args = parser.parse_args(argv)
    settings = env if env is not None else os.environ
    blockers = validate_channel(settings)
    status = {'mode':'READ_ONLY_PAPER','kind':'TELEGRAM_TEST',
              'telegram_api_accepted':False,'phone_receipt_verified':False,
              'broker_requests_made':False,'orders_placed':False,
              'configuration_valid':not bool(blockers),'blockers':list(blockers)}
    if blockers:
        status['probe'] = 'BLOCKED'
        print(json.dumps(status, sort_keys=True))
        return 2
    if args.check_only:
        status['probe'] = 'CONFIG_VALID_NO_NETWORK'
        print(json.dumps(status, sort_keys=True))
        return 0
    if not args.confirm_send:
        status['probe'] = 'EXPLICIT_CONFIRMATION_REQUIRED'
        print(json.dumps(status, sort_keys=True))
        return 2
    try:
        telegram_type(settings['TELEGRAM_BOT_TOKEN'], settings['TELEGRAM_CHAT_ID']).send(TEST_MESSAGE)
    except Exception:
        # Never print third-party exceptions; they may contain URL bot tokens.
        status['probe'] = 'TELEGRAM_API_NOT_CONFIRMED'
        print(json.dumps(status, sort_keys=True))
        return 2
    status['probe'] = 'TELEGRAM_API_ACCEPTED'
    status['telegram_api_accepted'] = True
    print(json.dumps(status, sort_keys=True))
    return 0


def main() -> None:
    raise SystemExit(run())


if __name__ == '__main__':
    main()
