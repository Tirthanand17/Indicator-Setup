# Type and dependency-lock verification — 23 October 2026

The active Python application now passes the complete configured mypy check: **zero errors across 49 source files**. The original baseline had 56 errors and the prior interim snapshot had 36. `audit/mypy-initial.txt` preserves the initial diagnostics; the former 36-error snapshot is available in the PR commit history. `audit/mypy-current.txt` records the new checked result. No type errors were hidden using new `Any`, `cast`, `# type: ignore`, or a weakened mypy configuration.

Verified in a fresh, isolated Linux Python 3.12.14 environment with mypy 1.18.2, types-requests 2.33.0.20261006 and the pinned application/test dependencies. Exact QA tooling inputs are in `cloud-alerts/requirements-typecheck.txt`.

From repository root, in an isolated Linux Python 3.12 virtual environment:

```sh
python -m pip install -r cloud-alerts/requirements-typecheck.txt
python -m mypy --no-incremental --cache-dir=/dev/null --config-file cloud-alerts/mypy.ini cloud-alerts/cloud_alerts
cd cloud-alerts
python -m pytest -q
```

Results after the two new regression tests: **mypy passed 49 files; Python 777 passed, 1 skipped, 1 third-party Starlette deprecation warning; Node 63 passed; `pip check` clean**. The two added tests cover a REVIEW signal with no candle and corrupted shadow tick state; both fail closed. The native local workerd SQLite Durable Object regression was also rerun in this environment: **1 passed** with synthetic local storage, restart and duplicate-alarm checks.

Typing scope: `check_untyped_defs = True` but this is **not strict typing**; `ignore_missing_imports = True` and `follow_imports = silent` remain as before. The installed Requests stubs exposed an additional HTTPAdapter override signature defect, now corrected without weakening its GET-only market-data guard. Passing mypy does not prove runtime security, performance, profitability, or cloud operation.

Dependency reproducibility: the prior offline exercise verified **29 exact Python 3.12 Linux x86_64 wheel artifact hashes**, a clean install using `--no-index --find-links --require-hashes`, and `pip check`. `cloud-alerts/requirements-linux-test.hashed.lock` is platform-specific, **not** a Windows/universal lock. `audit/build_wheel_lock.py` checks pinned wheel inventory. The QA type-check tooling file pins versions but does **not** itself provide artifact hashes; no wheels are committed. Default trading-capable Kite SDK dependency was removed; the unsupported live WebSocket shadow stays disabled pending separate review.

Checklist item **21 complete for its Linux 3.12 offline lock/type baseline**, bringing engineering to **16/25 (64%)**; live acceptance is **0/5**. Broader Git-history secret inspection, strict typing, universal package locks, cloud runtime integration and live data/Telegram verification remain outside this completed narrow deliverable. No cloud resource, broker order, live credentials, or Telegram messages were used.
