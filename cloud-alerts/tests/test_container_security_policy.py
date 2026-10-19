"""Static reproducibility tests for a cloud manifest; NOT actual VM tests."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_container_is_single_worker_and_preflights_with_private_umask():
    docker = (ROOT / 'Dockerfile').read_text()
    assert 'umask 077 && python -m cloud_alerts.preflight --json && exec uvicorn' in docker
    assert '--workers 1' in docker
    assert 'USER worker' in docker
    assert 'pip install' in docker


def test_compose_keeps_token_endpoint_off_public_container_port():
    compose = (ROOT / 'deploy' / 'compose.yml').read_text()
    assert '127.0.0.1:8080:8080' in compose
    assert 'read_only: true' in compose
    assert 'no-new-privileges:true' in compose
    assert 'nifty_alerts_state:/data/nifty-alerts' in compose
    assert '/private/nifty-alerts/worker.env' in compose
    assert 'ALERTS_ENABLED: true' not in compose


def test_sensitive_files_not_automatically_exported_or_added_to_image():
    docker = (ROOT / 'Dockerfile').read_text()
    for private in ('token.enc', 'worker.env', 'alerts.sqlite3'):
        assert f'COPY {private} ' not in docker
    assert 'COPY cloud_alerts ./cloud_alerts' in docker
