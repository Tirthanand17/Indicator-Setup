# Verification — 23 October 2026

Baseline: `05df18881160b52ecbbd1c118d439b0f9db5ea2e`, merged PR11. Local Ubuntu24.04/Python3.12.3 and Node24.18.0. All data and credentials synthetic. No live broker/Telegram calls.

| Check | Result | Interpretation |
|---|---|---|
| Baseline complete Linux Python suite | 744 passed, 1 skipped, 1 third-party warning; 57.61s | Independently reproduced historical count |
| Final complete Linux Python suite | **771 passed, 1 skipped, 1 third-party warning; 57.83s** | Calendar, data, ledger and transport regressions included |
| Combined edge and legacy extension Node tests | **63 passed, 0 failed**; 1.32s | 24 edge + 39 extension |
| Native local workerd SQLite DO runtime test | **1 passed, 0 failed** | Actual storage/alarm transaction rollback, duplicate callback, restart persistence; outbound service rejects all traffic |
| JS numerical parity | 3 indicator fixtures at tolerance1e-8; 36 fee cases exact paise | Covered by five of the edge tests; not full strategy parity |
| Python compileall / AST | Passed; baseline122 Python files parsed | Not static type checking |
| Baseline local relative import graph | No cycles detected | Limited graph, not dynamic-import or unused-code proof |
| Four tracked PowerShell parsers | Zero errors after fix | No Codespace or external resource created |
| git diff --check; node --check | Passed | Formatting/syntax only |
| npm audit after lockfile overrides | 0 known vulnerabilities at audit time | Advisory database is time-dependent |
| Python pip-audit on `python-environment.txt` | 23 records across4 packages, including duplicates | OPEN A11; not23 unique vulnerabilities |
| Linux pip check | No broken requirements | Dependency compatibility is not vulnerability clearance |
| Windows suite | Attempt interrupted; not a complete result | Missing pytest-asyncio and POSIX assumptions; use Linux reference result |
| Static type checker | Not completed | OPEN A17 |
| Live cloud acceptance | **0/5** | No synthetic result substitutes for a live gate |

Reproduce from repository root in an isolated Linux Python3.12 environment:

```sh
python -m pip install -r cloud-alerts/requirements-test.txt
cd cloud-alerts
python -m pytest -q
python -m compileall -q cloud_alerts
cd ..
node --test edge-cloudflare/*.test.mjs extension/tests/*.test.cjs
cd edge-cloudflare
npm ci --ignore-scripts
npm test
npm run test:runtime
```

Python requirements remain bounded rather than fully locked; `python-environment.txt` records the actual tested environment. Fresh resolution is not guaranteed identical. Native workerd may require execution permissions outside a restrictive sandbox. The runtime harness is local-only and never an entrypoint for deployment. Tests marked skipped remain skipped, not passed.
