# Dependency remediation — REST runtime

Default REST no longer imports or installs kiteconnect, Autobahn, Twisted or pyOpenSSL. The client implements only official market-data GET endpoints, preserving allowlisted TLS transport, pacing, no proxies and no redirects. Broker authentication headers follow the documented API contract. HTTP/JSON errors are redacted. Historical rows preserve timezone and integer volume; instrument CSV fields retain SDK-compatible types.

References: [market quotes/instruments](https://kite.trade/docs/connect/v3/market-quotes/) and [historical data](https://kite.trade/docs/connect/v3/historical/).

cryptography now requires50.0.2 or later within50.x. Fresh isolated Linux Python3.12 environment: full suite **774 passed,1 skipped,1 third-party warning,85.12s**. A subsequently added CSV test was verified with all REST contract tests: **15 passed**. Targeted REST/transport/streaming before that addition:39 passed. `pip check`: no broken requirements. Advisory scan of the fresh frozen environment: **No known vulnerabilities found**. This is database-dependent evidence, not a security guarantee. Old environment findings remain historical; it was not modified.

`requirements-linux-test.lock` pins the tested package versions, without artifact hashes. `audit/rest-environment.txt` records the scanner input. Windows resolution is not claimed verified.

Live WebSocket shadow construction without an injected test factory now fails explicitly pending a reviewed dependency solution. Default REST remains available. This is a deliberate temporary capability restriction; do not reinstall the vulnerable SDK to bypass it. Existing synthetic shadow tests remain available via injected factories.

Checklist item21 remains open for static type checking and stronger artifact-level reproducibility. Overall engineering stays15/25 (60%); live acceptance0/5. No broker request, real credential, Telegram message or cloud action performed.
