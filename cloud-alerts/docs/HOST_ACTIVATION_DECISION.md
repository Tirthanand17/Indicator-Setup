# Approval gate for an actually laptop-independent worker

**Status 2026-10-20: NO CLOUD SERVICE ACTIVATED.** This is a decision record, not an instruction to provision without operator approval. Budget remains ₹0 incremental expense unless the user separately authorizes a specific changed limit. No real credentials belong in GitHub.

## Comparison against the actual workload

| Candidate | Persistent always-on worker? | Decision today |
|---|---|---|
| Connected **Render Free** services | **No**. Web services sleep after 15 minutes without incoming activity; free instances have ephemeral files. The bot requires a persistent SQLite volume and uninterrupted session loops. | **Not suitable for live market alerts**. Do not repurpose another project. |
| **Oracle Cloud Always Free VM** | Potentially yes, subject to a real tenancy, in-region shape capacity, storage/network allocations, credit/quotas and billing safeguards. | **Preferred candidate for operator inspection**, not proof of availability or zero cost for this user's account. |
| **Google Cloud Free Tier e2-micro** | Potentially, but only eligible US regions, limited egress/storage and potentially separately billed public IPv4/network components. | Backup research only; **do not assume ₹0**. |

Sources (provider-owned, reviewed 20 October 2026): [Render Free limitations](https://render.com/docs/free), [Oracle Always Free resource definitions](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Google Free Tier usage limits](https://docs.cloud.google.com/free/docs/free-cloud-features).

## Approval-ready checklist (must all be verified by an operator before activation)

- Confirm a connected cloud tenancy and its account status, **home region**, exact VM shape, capacity and current free quotas. Record provider pricing for boot/block disk, backup, public IP, outgoing data, DNS, and certificates; choose no billable extras.
- Set provider-side spending controls/alerts as available and explicitly consent to any resource that can generate charges. **A budget alert is not necessarily a hard spend cap.**
- Check host OS, architecture (for example, Oracle A1 is ARM64), >=100 MiB free on a **worker-owned non-ephemeral volume**, one replica, no port 8080 exposure, inbound HTTPS only, time synchronization and secrets managed outside the public repository.
- Validate `docker compose config` and `caddy validate` with *real installed tools on the approved VM*. The local development environment did not include Docker or Caddy.
- Run `python -m cloud_alerts.preflight --json` against the actual mounted storage, initially `ALERTS_ENABLED=false`, then the synthetic localhost HTTP/restart rehearsal. Do **not** copy real tokens into tests.
- Verify trusted HTTPS certificate and only `POST /internal/token` publicly routed. The real read-only daily token transfer and Telegram phone test require explicit consent and configuration.
- Confirm the worker stays up while Nirala is OFF, across host restarts, and captures 5-minute REST boundaries with expected holiday handling. Collect five full market sessions before evaluating paper performance.

**Current blockers:** no verified Oracle/Google host tenancy, no selected cloud host/domain, no production TLS, no real token handoff to cloud, and no independently confirmed Telegram phone receipt. Keep trading alerts disabled until all tests pass.
