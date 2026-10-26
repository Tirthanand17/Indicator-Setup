# Inert Cloudflare identity verification

Implemented locally on 26 October 2026. Task 15 remains partial: the inspection
tooling is tested with synthetic responses, but **no actual target account or
deployment has been inspected**. No deployment, upload, resource creation,
plan change, card operation or runtime activation was performed.

## Purpose and pinned scope

`edge-cloudflare/cloudflare-identity-cli.mjs` is a GET-only metadata inspector
for the exact `nifty-paper-scheduler` Worker. It requires an explicitly supplied
account ID, namespace ID, version UUID and script ETag. It never discovers an
unrelated historical Worker by fuzzy name or treats a previously mentioned
D1/Cron deployment as proof of this SQLite Durable Object target.

The inspector follows these official API contracts:

- [Deployment list](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/): the first entry identifies the current deployment.
- [Version details](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/) and [script/version settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/): correlate the pinned version, ETag, bindings and runtime settings.
- [Namespace list](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/methods/list/): correlate the same namespace with the intended script/class and SQLite backend.
- [Subdomain settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/get/): inspect workers.dev and preview exposure.
- [Script settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/): inspect script-level logging switches and tail consumers.

The checked observation requires:

| Metadata | Required observation |
|---|---|
| Current deployment | Exactly one pinned version receiving 100% |
| Version | Exact expected UUID and script ETag |
| Runtime | Compatibility date 2026-07-30, no compatibility flags, migration tag v1 |
| Feature variables | All 16 flags present as plain-text `false`; names shared with disabled-template validator |
| Other bindings | Exactly `MARKET_SESSION`, class `MarketSession`, expected namespace; no extra/secret/service resources |
| Namespace | Exactly one matching ID, intended script/class, `use_sqlite=true` |
| Public subdomain | workers.dev and previews explicitly false |
| Script logging | Observability and Logpush explicitly false; no tail consumers |

If runtime export metadata is present, it must identify the intended SQLite
class without additional named exports or a container. Missing required fields,
contradictory configuration and unsupported response shapes fail closed.
The namespace list must be complete on one page (at most 1,000 entries);
pagination or absent completeness metadata blocks the observation. No claim
about an absent namespace is inferred from an incomplete page.

## Eight reads, no writes or runtime calls

For a matching target, the command performs eight sequential GETs:

1. Latest deployment (`deployments?per_page=1`).
2. The pinned version.
3. Current script/version settings.
4. The account namespace list (`page=1&per_page=1000`).
5. The script's subdomain settings.
6. Script-level settings.
7. Latest deployment again.
8. Current script/version settings again.

The final reads reject a changed deployment or bindings/runtime mismatch.
They do **not** make an atomic snapshot: other settings may change between
reads or after the report. This limitation is explicit in the report.

Only the fixed HTTPS Cloudflare API origin and fixed paths are used. Account,
namespace and version identifiers are format-checked; there is no caller-supplied
URL. Requests have no body, use manual redirects and disable caching. There
are no retries, POST/PATCH/PUT/DELETE requests, Worker endpoint requests, secret
uploads, DO instance creation, alarms, deployment operations or broker/bot calls.

Each request has a three-second fetch/body deadline by default, including a
transport that ignores abort, and a 512,000-byte JSON response ceiling. HTTP
errors, redirects, API errors, malformed/oversized bodies and timeouts produce
only a generic sanitized failure. Raw settings, provider messages, authors,
annotations and credentials never appear in the report. Identifiers/ETag are
represented by domain-prefixed SHA-256 fingerprints for later correlation;
fingerprints are not provider attestations or proof of authenticity.

## Invocation

From the repository root:

```text
node edge-cloudflare/cloudflare-identity-cli.mjs
```

This is help-only and makes **zero requests**, even if environment variables
exist. To inspect a separately authorized existing account, configure these
values through a secure local environment, not source files or chat:

| Environment variable | Purpose |
|---|---|
| `CLOUDFLARE_IDENTITY_READ_APPROVED=yes` | Explicit permission for this read-only command |
| `CLOUDFLARE_IDENTITY_ACCOUNT_ID` | Intended account (32 lowercase hex characters) |
| `CLOUDFLARE_IDENTITY_READ_TOKEN` | Dedicated account-scoped read credential |
| `CLOUDFLARE_IDENTITY_NAMESPACE_ID` | Independently expected SQLite namespace |
| `CLOUDFLARE_IDENTITY_VERSION_ID` | Independently expected version UUID |
| `CLOUDFLARE_IDENTITY_SCRIPT_ETAG` | Independently expected script ETag (32/64 lowercase hex) |

Then run:

```text
node edge-cloudflare/cloudflare-identity-cli.mjs --run
```

Use the least-privilege read permission accepted by the cited metadata endpoints,
restricted to the intended account. The inspector never upgrades permissions or
falls back to a global API key, Analytics token, deployment token or broker key.
It cannot prove that the supplied token's effective permissions are read-only;
that remains an account IAM review. The quality runner strips these environment
values and approval from tests, which inject only synthetic transport responses.

Exit codes: **0** help/no request; **1** blocked or failed inspection; **2**
metadata observed with outstanding acceptance requirements. Exit 2 deliberately
does not certify deployment acceptance. A matching observation has
`deploymentAccepted=false`, `releaseAuthorized=false`, `freePlanVerified=false`,
`noCardEligibilityVerified=false`, `sourceBundleVerified=false` and
`realOrdersEnabled=false`.

## What remains for task 15

All six required inspection environment values were absent in this session;
only their presence was checked, never credential contents. No Cloudflare
connector was available. Synthetic responses and local workerd tests therefore
earn no new cloud acceptance check.

The owner/account evidence must establish the actual account/target identifiers
and independently reviewed expected version/ETag before running the inspector.
Matching a supplied ETag is **not** proof that deployed code corresponds to this
repository's reviewed commit or bundle. Capture the exact reviewed upload
artifact and its mapping to provider version metadata separately.

Other outstanding evidence includes zone routes/custom domains and private
access policy; existing DO instances, stored state and alarms; effective IAM
and external log sinks; actual deployment/rollback rehearsal; and current Free
plan/no-card eligibility with no paid-resource provisioning. An empty or
successful metadata response cannot establish these. The inspector does not
query billing/payment data, create previews or trigger any of those actions.

The committed template remains disabled, with workers.dev/preview URLs false
and all runtime flags false. Any deployment remains a separate action subject
to the existing owner authorization and no-paid-resource constraints. Five
live acceptance gates and actual resource/cost measurements remain unverified.

Regression evidence covers exact identity/namespace matching, all disabled
flags, split rollouts, additional resources, incomplete pagination, concurrent
changes, deadlines, redaction, redirect rejection and the help/approval/exit-code
contract. Full offline quality and combined CI remain required for each change.
