"""Fail-closed, secret-redacting runtime configuration checks.

Only diagnostic *codes* leave this module. Do not echo environment values in
errors, logs, health endpoints, or the public GitHub repository.
"""
from __future__ import annotations

from collections.abc import Mapping
import re
from cryptography.fernet import Fernet


def _is_placeholder(value: str) -> bool:
    value = value.strip().upper()
    return (not value or value.startswith(('REPLACE_WITH_', 'YOUR_', 'PASTE_',
            'INSERT_', 'CHANGEME', 'CHANGE_ME', '<', '${')) or value in
            {'TODO', 'TBD', 'PLACEHOLDER', 'NONE', 'NULL'})


def configuration_blockers(env: Mapping[str, str]) -> tuple[str, ...]:
    """Return only safe codes. Strict formats apply when alerts are enabled.

    Disabled systems can use mock settings for development, but must never
    pass through copied `.env.example` placeholders or malformed keys when
    enabled for actual market-data and phone-notification use.
    """
    problems: list[str] = []
    identifiers = ('KITE_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID')
    for name in identifiers:
        value = env.get(name, '')
        if not value or not value.strip():
            problems.append('MISSING_' + name)
        elif _is_placeholder(value):
            problems.append('PLACEHOLDER_' + name)

    relay = env.get('TOKEN_RELAY_HMAC_KEY', '')
    if not relay or len(relay) < 32:
        problems.append('INVALID_TOKEN_RELAY_HMAC_KEY')
    elif _is_placeholder(relay):
        problems.append('PLACEHOLDER_TOKEN_RELAY_HMAC_KEY')
    if env.get('ALERTS_ENABLED', 'false').strip().lower() == 'true' and len(set(relay)) < 8:
        problems.append('INVALID_ACTIVE_RELAY_KEY_ENTROPY')
    vault_key = env.get('TOKEN_VAULT_KEY', '')
    try:
        Fernet(vault_key.encode('ascii'))
    except (ValueError, TypeError, UnicodeError):
        problems.append('INVALID_TOKEN_VAULT_KEY')

    flags = ('ALERTS_ENABLED', 'KITE_SHADOW_ENABLED', 'PAPER_PREMIUM_TRACKING_ENABLED',
             'PAPER_DASHBOARD_ENABLED', 'PAPER_AUTOTRADE_ENABLED')
    for name in flags:
        if env.get(name, 'false').strip().lower() not in {'true', 'false'}:
            problems.append('INVALID_BOOLEAN_' + name)

    if env.get('PAPER_DASHBOARD_ENABLED','false').strip().lower() == 'true':
        key=env.get('PAPER_DASHBOARD_KEY','')
        if len(key)<32 or len(set(key))<8 or _is_placeholder(key):
            problems.append('INVALID_PAPER_DASHBOARD_KEY')
    if env.get('PAPER_AUTOTRADE_ENABLED','false').strip().lower() == 'true':
        if (env.get('ALERTS_ENABLED','false').strip().lower()!='true'
                or env.get('PAPER_DASHBOARD_ENABLED','false').strip().lower()!='true'):
            problems.append('INVALID_PAPER_AUTOTRADE_DEPENDENCIES')
    if env.get('ALERTS_ENABLED', 'false').strip().lower() == 'true':
        api_key = env.get('KITE_API_KEY', '')
        if not re.fullmatch(r'[A-Za-z0-9]{16,32}', api_key):
            problems.append('INVALID_ACTIVE_KITE_API_KEY_FORMAT')
        bot = env.get('TELEGRAM_BOT_TOKEN', '')
        if not re.fullmatch(r'[0-9]{6,16}:[A-Za-z0-9_-]{30,100}', bot):
            problems.append('INVALID_ACTIVE_TELEGRAM_BOT_TOKEN_FORMAT')
        chat = env.get('TELEGRAM_CHAT_ID', '')
        if not re.fullmatch(r'-?[1-9][0-9]{4,19}', chat):
            problems.append('INVALID_ACTIVE_TELEGRAM_CHAT_ID_FORMAT')
    return tuple(dict.fromkeys(problems))
