"""Read-only heuristic scan of all reachable Git blobs; never prints matched values.

No claim about unreachable/deleted objects, remote-only refs, external logs or
undetected secret formats. Findings require review and are not auto-dismissed.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess

RULES = {
    'TELEGRAM_TOKEN': rb'\b[0-9]{6,12}:[A-Za-z0-9_-]{30,60}\b',
    'GITHUB_TOKEN': rb'\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b',
    'AWS_ACCESS_ID': rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'PRIVATE_KEY_BLOCK': rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----',
    'SECRET_ASSIGNMENT': rb'''(?i)(?:api_secret|access_token|bot_token|hmac_key|vault_key)\s*[=:]\s*["']([A-Za-z0-9_+/=:-]{24,256})["']''',
}


def scan_blob(raw: bytes) -> dict[str, int]:
    return {name: len(matches) for name, pattern in RULES.items()
            if (matches := list(re.finditer(pattern, raw)))}


def scan_history(repo: Path) -> dict:
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=repo, stderr=subprocess.DEVNULL)
    shallow = git('rev-parse', '--is-shallow-repository').strip() == b'true'
    objects = git('rev-list', '--objects', '--all').splitlines()
    commits = int(git('rev-list', '--all', '--count'))
    findings = []
    blob_count = byte_count = 0
    with subprocess.Popen(['git', 'cat-file', '--batch'], cwd=repo, stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
        assert process.stdin is not None and process.stdout is not None
        try:
            for item in objects:
                oid, _, name = item.partition(b' ')
                if not re.fullmatch(rb'[a-f0-9]{40,64}', oid):
                    raise ValueError('INVALID_GIT_OBJECT_ID')
                process.stdin.write(oid + b'\n')
                process.stdin.flush()
                header = process.stdout.readline().split()
                if len(header) != 3:
                    raise ValueError('INVALID_GIT_OBJECT_HEADER')
                size = int(header[2])
                raw = process.stdout.read(size)
                if len(raw) != size or process.stdout.read(1) != b'\n':
                    raise ValueError('INCOMPLETE_GIT_OBJECT')
                if header[1] != b'blob':
                    continue
                blob_count += 1
                byte_count += size
                # A path hint is classification metadata, never a clean-result exemption.
                fixture = b'/tests/' in b'/' + name or b'/test-support/' in b'/' + name or b'.test.' in name
                for rule, count in scan_blob(raw).items():
                    findings.append({'object_id': oid.decode('ascii'), 'rule': rule,
                                     'occurrences': count, 'test_path_hint': fixture})
        finally:
            process.stdin.close()
        if process.wait(timeout=30) != 0:
            raise ValueError('GIT_OBJECT_SCAN_FAILED')
    return {'format': 'REACHABLE_GIT_SECRET_HEURISTICS_V1', 'shallow_repository': shallow,
            'reachable_commits': commits, 'unique_blobs_scanned': blob_count,
            'blob_bytes_scanned': byte_count, 'rules': list(RULES), 'findings': findings,
            'matched_values_printed': False, 'credentials_verified_absent': False,
            'remote_only_refs_and_external_logs_scanned': False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path('.'))
    args = parser.parse_args()
    try:
        report = scan_history(args.repo)
        print(json.dumps(report, sort_keys=True))
        return 2 if report['findings'] or report['shallow_repository'] else 0
    except (OSError, ValueError, subprocess.SubprocessError):
        print(json.dumps({'error': 'REDACTED_HISTORY_SCAN_FAILED'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
