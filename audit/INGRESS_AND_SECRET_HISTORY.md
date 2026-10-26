# Ingress hardening and reachable-history review

Implemented locally on 26 October 2026. Task 14 is partially complete: source
controls and a local history review are verified; deployed perimeter, account
IAM and external log configuration remain unverified. No deployment, credential
rotation, history rewrite, account change or provider message was performed.

## Worker admission and routing

The outer Worker admits public dashboard and token-relay requests before a
Durable Object lookup. Limits apply to **all** admitted attempts, successful
or unsuccessful, in a fixed 60-second window:

| Route category | Attempts/window/isolate | Concurrent forwards/isolate |
|---|---:|---:|
| Dashboard login POST | 30 | 4 |
| Token relay POST | 60 | 4 |
| Other allowed dashboard routes | 240 | 8 |

The budgets are separate. Forwarding releases a concurrency lease in `finally`,
including exceptions; release is idempotent. Window rollover resets attempt
counts but preserves active leases. Clock rollback cannot reset a budget.
Rejected requests return sanitized, noncacheable 429 responses with Retry-After;
they perform no DO lookup, storage operation or external provider call.
Public-budget exhaustion does not consume or block the administrator emergency
halt route. Authentication and all existing disabled-by-default flags remain.

The outer Worker and DO reject HTTP and query parameters on internal routes
before authentication/storage. The outer dashboard routes now have an exact
path/method allowlist; non-API query strings are rejected before forwarding.
Existing dashboard API query validation remains in the authenticated handler.

These are bounded in-memory, **per-isolate** defenses. They reset on isolate
replacement, do not coordinate across locations/isolates and do not cap total
Worker invocations, charges or attack traffic. They do not maintain IP/client
identities, write new DO records, change archives or add a paid service. A
distributed attack can still exhaust shared quotas or the owner's public
admission window. Authenticated admin requests are intentionally outside these
public budgets; their secret and perimeter controls remain necessary.

No platform rate-limiting binding was added or activated. Cloudflare's
[rate-limiting binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
also describes location-local limits; adding a binding would not by itself prove
global cost protection. Actual plan eligibility, private route/access policy,
perimeter limits and measured abuse behavior must be verified on the target
account before public exposure. The committed template still has no public
workers.dev/preview URLs and all runtime flags remain false.

## Body size and duration

All Worker ingress readers share a **three-second whole-body read deadline**:
relay JSON (2,048 bytes), login form (1,024 bytes), delivery reconciliation JSON
(4,096 bytes), archive/lifecycle/position reconciliation (existing 5,350,000-byte
ceiling), and body-forbidden bootstrap/halt requests (zero bytes). The deadline
does not restart for each chunk. Existing size/status semantics are preserved,
including reconciliation's 413 for oversize input.

On timeout, overflow or read failure, the reader is cancelled and its lock
released. Cancellation itself is never awaited because an untrusted stream
could leave its cancellation promise pending. Invalid token/login bodies
cannot reach signature acceptance, token/nonce writes or session issuance.
Slow authenticated archive uploads may now fail; operators must not interpret
an interrupted mutation response as proof that a remote operation did not run.
The bound covers reading, not subsequent parsing, storage or provider duration.
Archive/operator clients also use the bounded readers for downloaded JSON.

The separate legacy Python service now limits token handoff to 60 attempts/minute
and four concurrent handlers per process, with an asyncio whole-body deadline
of three seconds and the existing 2,048-byte ceiling. Timeout returns 408 and
attempt exhaustion returns 429. It does not coordinate processes or harden
other legacy routes. Its production TLS/proxy perimeter remains an external
deployment requirement; no claim about the deployed legacy service is made.

## Redacted local history scan

`python scripts/scan-git-history.py --repo .` reads all unique reachable Git
objects across **local refs** through Git's batch interface and scans every
blob. It reports rule names, object IDs, occurrence counts and fixture-path
hints, never matched values or surrounding source lines. Findings return exit
2 rather than silently passing; shallow history also returns 2. Scan failures
return a generic error without Git stderr/source contents.

Snapshot reviewed: `e5471692d37a7020c8fa4329ce16b1e8ae43284e` and all then-local
refs, before the ingress commit:

| Evidence | Result |
|---|---:|
| Reachable commits | 410 |
| Unique blobs | 1,088 |
| Blob bytes scanned | 17,222,150 |
| Shallow repository | false |
| Telegram-shaped rule/blob findings | 15 |
| Secret-assignment rule/blob findings | 31 |
| GitHub/AWS/private-key rule findings | 0 |

All 46 rule/blob findings mapped to test-fixture paths. Redacted review of the
58 matched occurrences found 30 explicit synthetic/test markers and 28
predictable public alphabet/uniform sequences (one sequence includes a separator).
No actual credential was confirmed by this review. Fixture paths are only hints,
not automatic exclusions, and the scanner retains their findings.

This is a **heuristic review**, not proof that the repository never contained a
credential. It does not establish secret provenance or validity, cover every
possible secret encoding/format, fetch remote-only refs, examine unreachable or
reflog-only objects, scan other computers or inspect external logs. No values
were sent to any provider for validity testing. Rerun after future source/ref
changes. A regression creates a temporary Git history with a removed
secret-shaped public fixture and confirms that the old blob is still found
without printing its value.

## Evidence still required for task 14

No Cloudflare account connector was available in this session. Repository flags
and local simulated traffic cannot establish actual account security. Record
redacted evidence for the exact target Worker and namespace covering:

- Public routes, preview/development URLs, HTTPS/private-access policy and
  perimeter admission controls, with an abuse test and actual invocation counts.
- Effective token/member permissions, account/resource scope and separation of
  runtime, deployment and read-only inspection identities; no token values.
- Worker observability/tail destinations, Logpush/sinks and retention/redaction
  policies; verify that authorization, relay bodies, cookies and archive contents
  are not recorded. The local template's observability=false is not account proof.
- Provider-hosted secret-scanning coverage and remote-only history/ref coverage,
  plus rotation/remediation evidence if any genuine historical secret is found.

Native workerd/SQLite tests verify that failed logins and a 429 leave durable
state unchanged and that authenticated emergency halt still succeeds. Unit
tests cover fixed-window/concurrency behavior, stalled/drip-fed bodies,
nonsettling cancellation, TLS/query rejection, route admission and the existing
HMAC/archive/accounting regressions. This work earns no additional cloud or
security acceptance point while deployed account evidence remains outstanding.
