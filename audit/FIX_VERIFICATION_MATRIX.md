# Verification — 23 October 2026

Baseline: `05df18881160b52ecbbd1c118d439b0f9db5ea2e`, merged PR11. Original audit ran Ubuntu24.04/Python3.12.3 and Node24.18.0. Follow-up used a fresh local Linux Python3.12.14 virtualenv and Node24.19.0. All test data/credentials synthetic; no live broker/Telegram calls.

| Check | Result | Interpretation |
|---|---|---|
| Baseline complete Linux Python suite | 744 passed, 1 skipped, 1 third-party warning; 57.61s | Independently reproduced historical count |
| Earlier complete Linux Python suite | **771 passed, 1 skipped, 1 third-party warning; 57.83s** | Historical calendar/data/ledger/transport regression result |
| Latest fresh Python3.12 virtualenv suite | **777 passed, 1 skipped, 1 third-party warning; 13.97s** | Two extra fail-closed regressions included; synthetic only |
| Combined edge and legacy extension Node tests | **113 passed, 0 failed**; current Phase16 | 74 edge + 39 extension; offline synthetic rerun |
| Native local workerd SQLite DO runtime test | **1 passed, 0 failed**; rerun in temporary checkout | Actual storage/alarm transaction rollback, duplicate callback, restart persistence; outbound service rejects all traffic |
| JS numerical parity | 3 indicator fixtures at tolerance1e-8; 36 fee cases exact paise | Covered by five of the edge tests |
| JS Python strategy and exit-rule parity | 30 synthetic decision cases (including CE/PE); 5 premium ASK references, 3 premium BID and 8 paper exit cases; plus risk-first fail-closed regressions | Pure rule port only; not a Worker or full-session integration. [Phase16](PHASE16_DECISION_EXIT_PARITY.md) |
| Python compileall / AST | Passed; baseline122 Python files parsed | Not static type checking |
| Baseline local relative import graph | No cycles detected | Limited graph, not dynamic-import or unused-code proof |
| Four tracked PowerShell parsers | Zero errors after fix | No Codespace or external resource created |
| git diff --check; node --check | Passed | Formatting/syntax only |
| npm audit after lockfile overrides | 0 known vulnerabilities at audit time | Advisory database is time-dependent |
| Historical Python pip-audit on `python-environment.txt` | 23 records across4 packages, including duplicates | Obsolete SDK chain removed from default runtime; earlier fresh REST scan found no known advisories; not a new scan |
| Linux pip check | No broken requirements in latest isolated virtualenv | Dependency compatibility is not vulnerability clearance |
| Windows suite | Attempt interrupted; not a complete result | Missing pytest-asyncio and POSIX assumptions; use Linux reference result |
| Full configured mypy | **Success: 49 source files, 0 errors** (mypy1.18.2 with pinned Requests stubs) | Not strict mypy; Git-history review still open A17 |
| Live cloud acceptance | **0/5** | No synthetic result substitutes for a live gate |

Reproduce from repository root in an isolated Linux Python3.12 environment:

```sh
python -m pip install -r cloud-alerts/requirements-typecheck.txt
python -m mypy --no-incremental --cache-dir=/dev/null --config-file cloud-alerts/mypy.ini cloud-alerts/cloud_alerts
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

The prior 29-wheel hashed Python3.12 Linux lock verifies artifacts for that platform; the separate pinned mypy/type-stub tooling requirements are version-locked but not hash-locked. `python-environment.txt` is a historical snapshot. Fresh resolution from bounded production requirements is not guaranteed identical. Native workerd may require execution permissions outside a restrictive sandbox. The runtime harness is local-only and never an entrypoint for deployment. Tests marked skipped remain skipped, not passed.
