# Phase 36 — token and Telegram outbound HTTPS isolation

**Status: committed source and offline regression tests; NOT cloud deployed.** No real Kite token, Telegram credential, phone message, broker call, user PC, cloud host, infrastructure charge or live order was used.

## Discovered security mismatch

- The daily protected-file token sender previously used requests.post(), which inherits environment HTTP_PROXY/HTTPS_PROXY/ALL_PROXY and REQUESTS_CA_BUNDLE/CURL_CA_BUNDLE settings by default. That is inappropriate for forwarding a broker bearer token to an explicitly approved cloud token endpoint.
- The Telegram transport similarly placed a bot credential in the Bot API HTTPS URL and previously inherited those environment settings.
- The sender URL parser allowed non-443 ports and private/loopback-looking hosts while the public ingress acceptance probe and Windows installer correctly required a public HTTPS hostname on port 443. Different rules across components could allow an operator mistake.

## Implementation

1. The token sender now uses the **same strict structural public HTTPS endpoint validator** as the existing deployment ingress probe: exact '/internal/token' path on HTTPS port 443, public-looking FQDN, no URL credentials, query or fragments, and no numeric IP / localhost / private suffix.
2. Both credential-bearing senders use a temporary requests.Session with trust_env=False, verify=True and allow_redirects=False. This disables ambient proxy and custom CA bundle environment variables. No transport exception text or remote server body is printed; request timeouts remain bounded.
3. Existing signed handoff integration mocks were updated to assert trust_env=False and verify=True. New synthetic regression coverage includes rejected private/custom-port endpoints, hostile proxy and CA environment variables, failed TLS, failed Telegram redirects, credential exclusion, read-only protected source and sanitized error output.
4. Production KiteConnect SDK's **separate** broker-data HTTP transport is not modified by this phase. Its proxy policy needs validation with the approved installed SDK before live activation.

## Operational consequence

If the operator's Windows connection or cloud host needs an enterprise HTTPS proxy/custom CA, the sender may now fail closed instead of sending credentials through that path. Use an approved direct TLS egress connection. **Do not turn off Nirala based only on a local message:** verify the real HTTPS token acceptance and Kite REST auth on the approved cloud host first.

These controls do not protect a compromised operating system, a hostile DNS environment with trusted certificates, an incorrect but syntactically valid host, leaked credentials or unavailable broker/Telegram services. A public-looking FQDN is **not evidence that an endpoint belongs to the operator**; the human must explicitly approve the exact host.

## Validation status

- Phase 34's **451/451** is historically documented, not freshly reproduced during this phase.
- Phase 35 added 10 synthetic tests but the full baseline was not re-run.
- Phase 36 adds **18 pytest cases** by static collection count (11 parametrized URL rejections + 7 other direct outbound tests) and updates existing test mocks.
- **Full combined suite has not been executed**: do not present 479/479 as passing. No GitHub Actions credits or unrelated host resources were consumed. Review and execute pytest from a permitted local or approved cloud development environment before enabling alerts.
- Engineering milestone estimate remains **80%**; cloud host, domain, real TLS handoff, phone receipt, laptop-off continuity and five actual market sessions still unverified.
