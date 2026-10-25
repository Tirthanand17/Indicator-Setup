# Offline quality gates

Verified on GitHub: [run 40193418706](https://github.com/Tirthanand17/Indicator-Setup/actions/runs/40193418706)
passed all installation, quality and advisory steps for commit
`ad6ff181b2786b635206ea8fab9f3a0780ca8fc5` on 25 October 2026.

The `Offline quality` workflow runs on pull requests to main, pushes to main,
and manual dispatch. Its single standard `ubuntu-24.04` job is limited to 15
minutes, uses immutable action references and read-only repository permissions,
and does not persist checkout credentials. It runs only while the repository
is public. Public standard GitHub-hosted runners are free under the published
[GitHub Actions billing policy](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
No cache or artifact storage is provisioned by this workflow.

## Checks

- ESLint recommended correctness checks for edge modules/tests, extension and
  quality scripts, including unused variables. Formatting is not a gate.
- Ruff syntax/undefined-name/control-flow checks (`E9`, `F63`, `F7`, `F82`) for
  all Python application/tests and parity generators.
- Existing mypy baseline for 49 application source files. It is not strict
  typing; missing third-party imports are still ignored by that baseline.
- All edge JavaScript, extension and quality-runner regression tests.
- Native workerd/SQLite persistence, restart and concurrency tests.
- Disabled Cloudflare template preflight.
- Full Python 3.12 Linux regression suite.
- npm and Python dependency advisory checks; known advisories fail the job.

The local runner stops at the first failing check, propagates its exit code,
and treats process startup failures/signals as failures. Each check has a
10-minute local watchdog. Each subprocess receives an allowlist of basic OS
environment values; broker, bot/cloud tokens, Python import overrides and Node
startup options are not inherited. All application/runtime flags are false.
Tests that exercise activation use their own explicit synthetic fixtures.

Dependency installation and advisory queries use public registries. Market and
Telegram clients in the tests use fake responses or reject external traffic.
There are no deploy steps, cloud credentials, or sender activation steps.

## Local commands

Install the exact JS lock from `edge-cloudflare`:

```sh
npm ci --ignore-scripts --no-fund --no-audit
npm run quality:js
```

For the full suite, use Linux with Node 24.18.0 and a Python 3.12 virtualenv.
From the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r cloud-alerts/requirements-linux-test.hashed.lock
.venv/bin/python -m pip install -r cloud-alerts/requirements-quality.txt
export QUALITY_PYTHON="$PWD/.venv/bin/python"
cd edge-cloudflare
npm run quality:all
```

`QUALITY_PYTHON` selects only the Python executable, not credentials or a live
configuration. The QA tool versions are exact pins; application/test wheels
have hashes. QA-tool transitive dependencies are resolved by pip and do not yet
have a separate fully hashed toolchain lock. Registry outages fail the advisory
gate rather than being silently converted into a clean scan.

The narrow ESLint `preserve-caught-error` exception applies only to the Kite
transport: it deliberately discards upstream error causes that may contain
credentials. Existing redaction regressions cover this behavior. Browser globals
loaded by `importScripts` are declared only for the extension background script.

CI success proves the selected offline checks passed. Live cloud acceptance,
deployment, actual phone receipt and trading profitability remain separate.
Repository branch-protection/required-check policy is an account-side setting;
the committed workflow publishes a failing status but does not itself configure
that setting.
