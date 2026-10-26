# NSE F&O calendar maintenance

Implemented locally on 26 October 2026. Calendar data remains limited to 2026;
an official 2027 F&O annual calendar has not been verified in this work. No
deployment, session activation or live calendar feed is claimed.

## Reviewed sources and classifications

The canonical manifest is
`cloud-alerts/cloud_alerts/data/nse-fo-calendar.json`. It records circular IDs,
publication dates, official URLs, SHA-256 hashes and the review date:

| Circular | Purpose |
|---|---|
| [NSE/FAOP/71777](https://nsearchives.nseindia.com/content/circulars/FAOP71777.pdf) | Annual 2026 F&O weekday holidays |
| [NSE/FAOP/72262](https://nsearchives.nseindia.com/content/circulars/FAOP72262.pdf) | Additional 15 January election closure |
| [NSE/FAOP/76940](https://nsearchives.nseindia.com/content/circulars/FAOP76940.pdf) | 8 November Muhurat: continuous trading 14:20–15:40 IST |

The public PDFs were downloaded and their bytes hashed during this review.
PDFs remain outside Git; the manifest contains public provenance metadata and
classification facts. The official [holiday page](https://www.nseindia.com/resources/exchange-communication-holidays)
is a discovery starting point, not an automatic data feed.

Muhurat remains `SPECIAL` before weekend classification, and cannot claim a
normal automated paper tick. Exceptional Saturday sessions must also be
explicit `SPECIAL` overrides, even if their hours resemble normal trading.
Unknown special-session hours can be two nulls; they cannot enable trading.
Unsupported years return unavailable and cannot arm a future normal session.

## One manifest, checked build artifacts

`node scripts/calendar-maintenance.mjs --check` validates the manifest and checks
both generated artifacts: `edge-cloudflare/calendar-data.mjs` and
`cloud-alerts/cloud_alerts/calendar_digest.py`. The JavaScript runtime imports
deeply frozen data; Python checks the JSON byte digest at import and stops on
missing/altered data. Targeted Git attributes keep these files LF on Windows
and Linux. The quality runner requires the generation check before JS tests.
The Dockerfile copies the complete Python package including its data directory.

The strict schema rejects wrong segments, unofficial URL shapes, source/year
mismatches, duplicate/invalid dates, contradictory overrides, regular-session
overrides and automatic exceptional-session eligibility. PDF hash matching
detects mismatched local evidence; it does **not** certify that a file or its
declared URL is authentic, complete or the latest exchange amendment.

The existing revision remains `NSE-FO-2026-FAOP71777-FAOP72262`: this refactor
does not change any date's classification or persisted calendar identity.

## Inspection and staged updates

Run these commands from the repository root:

```text
node scripts/calendar-maintenance.mjs status 2026-11-16
python -m cloud_alerts.calendar_cli --date 2026-11-16
```

For the Python command run from `cloud-alerts` or set the normal package path.
Inspection reports the review date, covered years/end date and a refresh warning
45 days before coverage ends. The existing read-only operational health report
emits `CALENDAR_EXPIRING` from 16 November 2026; the existing external watchdog
can deduplicate/notify that warning if separately configured. No watchdog is
activated here. Inspection always discloses that the calendar is not live.

Maintenance procedure:

1. At least weekly, and before the next session after an exchange announcement,
   inspect official NSE **F&O** circulars for annual holidays, amendments,
   emergency closures and exceptional sessions. This is an operator procedure;
   no claim of automated publication monitoring is made.
2. Download official PDFs to an evidence directory. Read their segment, dates,
   publication and supersession language. Copy the current manifest to a
   candidate, record the evidence hashes and review date, and assign a new
   revision for every change. Preserve earlier years needed by historical data.
3. Stage a new directory, which must not already exist:

   ```text
   node scripts/calendar-maintenance.mjs prepare candidate.json official-pdfs new-calendar-review
   ```

   This validates schema and local PDF hashes before writing three proposed
   artifacts and review instructions. It never promotes files, changes runtime
   state, contacts providers or deploys. Future review dates are rejected.
4. Review the candidate diff against actual official PDFs. A successful staging
   command is not exchange verification. Promote the JSON and both artifacts
   together through a reviewed source change. `--write` can regenerate active
   build artifacts from an already reviewed canonical JSON; it fetches nothing.
5. Run the full offline quality gate and inspect Python/JS parity across every
   covered day, amendments, exceptional days and unsupported year boundaries.
   Combined GitHub CI requires Node and Python; the parity test skips only when
   the separate local Python environment lacks Node.
6. Before any deployment with a new revision, halt the runtime and archive its
   state. Existing scheduler/archive readers require exact calendar revisions;
   review and test migration/rollback compatibility before deploying. Do not
   rewrite stored versions, auto-resume or assume this tool migrates archives.

## Evidence and remaining work

Regressions cover all 365 classifications in the active year, cross-language
parity in combined CI, structural rejection, immutable runtime data, altered
Python manifest bytes, matched/mismatched staged evidence, destination
preservation, exceptional-session exclusion, expiry warning and no year-end
rearm into an unsupported year. Native runtime/recovery regressions continue
to exercise the unchanged persisted revision.

Task 13 remains partially complete until an official 2027 F&O annual circular
and any amendments are verified and reviewed. Other application components
still deliberately restrict persisted trading/reporting fields to 2026; a
future-year activation must update and test those restrictions and revision
migrations together. Adding a year to the manifest alone is not readiness.
Actual calendar supervision and cloud notification delivery remain unverified.
The overall acceptance score remains 27/41 and live acceptance remains 0/5.
