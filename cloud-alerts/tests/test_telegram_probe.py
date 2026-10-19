"""Offline tests: fake Telegram transport only, no external HTTP calls."""
import json
from cloud_alerts.telegram_probe import TEST_MESSAGE, run, validate_channel

VALID = {
    'TELEGRAM_BOT_TOKEN': '123456789:' + 'C' * 35,
    'TELEGRAM_CHAT_ID': '123456789',
}


class FakeTelegram:
    sent = []
    def __init__(self, bot_token, chat_id):
        assert bot_token == VALID['TELEGRAM_BOT_TOKEN']
        assert chat_id == VALID['TELEGRAM_CHAT_ID']
    def send(self, value):
        self.sent.append(value)


class RejectTelegram(FakeTelegram):
    def send(self, value):
        raise RuntimeError('SECRET_FROM_PROVIDER_' + VALID['TELEGRAM_BOT_TOKEN'])


def test_probe_readonly_does_not_call_network(capsys):
    FakeTelegram.sent.clear()
    assert run(['--check-only'], env=VALID, telegram_type=FakeTelegram) == 0
    out = json.loads(capsys.readouterr().out)
    assert out['probe'] == 'CONFIG_VALID_NO_NETWORK'
    assert out['telegram_api_accepted'] is False
    assert out['phone_receipt_verified'] is False
    assert not FakeTelegram.sent


def test_send_requires_explicit_second_confirmation(capsys):
    FakeTelegram.sent.clear()
    assert run(['--send-test'], env=VALID, telegram_type=FakeTelegram) == 2
    out = json.loads(capsys.readouterr().out)
    assert out['probe'] == 'EXPLICIT_CONFIRMATION_REQUIRED'
    assert not FakeTelegram.sent


def test_explicit_test_never_claims_market_signal_or_device_receipt(capsys):
    FakeTelegram.sent.clear()
    assert run(['--send-test','--confirm-send'],env=VALID,telegram_type=FakeTelegram) == 0
    out = json.loads(capsys.readouterr().out)
    assert out['telegram_api_accepted'] is True
    assert out['phone_receipt_verified'] is False
    assert out['orders_placed'] is False
    assert FakeTelegram.sent == [TEST_MESSAGE]
    assert 'TEST ONLY' in FakeTelegram.sent[0]
    assert 'NOT a market signal' in FakeTelegram.sent[0]


def test_rejected_provider_error_does_not_print_secret(capsys):
    assert run(['--send-test','--confirm-send'],env=VALID,telegram_type=RejectTelegram) == 2
    output = capsys.readouterr().out
    assert 'TELEGRAM_API_NOT_CONFIRMED' in output
    assert VALID['TELEGRAM_BOT_TOKEN'] not in output
    assert 'SECRET_FROM_PROVIDER_' not in output


def test_invalid_configuration_exits_without_sending(capsys):
    FakeTelegram.sent.clear()
    assert run(['--send-test','--confirm-send'], env={'TELEGRAM_BOT_TOKEN':'bad'},telegram_type=FakeTelegram) == 2
    obj = json.loads(capsys.readouterr().out)
    assert obj['blockers'] == ['TELEGRAM_BOT_CONFIG_INVALID','TELEGRAM_CHAT_CONFIG_INVALID']
    assert obj['configuration_valid'] is False
    assert not FakeTelegram.sent


def test_rejects_injected_chat_or_bot_format():
    assert validate_channel({**VALID,'TELEGRAM_CHAT_ID':'-10012345 extra'}) == ('TELEGRAM_CHAT_CONFIG_INVALID',)
    assert validate_channel({**VALID,'TELEGRAM_BOT_TOKEN':'REPLACE_WITH_BOT'}) == ('TELEGRAM_BOT_CONFIG_INVALID',)
