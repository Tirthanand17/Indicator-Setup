# Optional Windows sign-in watcher for daily Kite access-token handoff

**Status:** Installation scripts committed for operator review; **NOT installed or tested on Nirala**, not live on a cloud host. No monthly charge, order execution, or extra Kite authentication privileges. Tests on the Linux development host inspect the script's safety invariants and run Python's synthetic `.env --check-only`; they **do not run or validate Windows Task Scheduler, PowerShell or DPAPI**.

## Why this matters

The user authenticates to Zerodha as usual each market morning. Their separate, existing `Automation Day Trading` application then saves a daily `ZERODHA_KITE_ACCESS_TOKEN` in its protected `.env` file. A cloud bot cannot read the file when Nirala is switched off. The existing Python `--watch` sender automatically notices changes every 45 seconds **while Windows is on** and sends only the API key and access token over authenticated HTTPS. The installer below prepares that sender to start on *Windows user sign-in*, so they do not have to open a Kite chart or browser extension just to launch the watcher.

**Important:** The broker's daily login is still necessary. The PC must be on long enough for token receipt and confirmed secure upload; only then may it be switched off. This is not an automatic Zerodha login or an unattended cloud-host setup.

## Prerequisites — do not skip

1. Explicit operator approval of the **actual always-on cloud VM**, a persistent private volume, HTTPS FQDN `/internal/token`, and verified ₹0 additional cost. **None has been approved/activated yet.** Do not run the installer before this.
2. Cloud `ALERTS_ENABLED=false` until actual phone, broker, certificate, and reliability acceptance gates pass.
3. An installed and tested Python interpreter on Windows, and a checked-out copy of this `cloud-alerts` source **outside** the protected trading directory.
4. A current-user Windows account with Task Scheduler support; no Administrator/SYSTEM task, no unattended privileged execution.
5. Two values supplied interactively on the local machine, **never in GitHub or ChatGPT**: the Kite API key and the shared relay HMAC key already installed in the approved cloud secret store.

## Preview before installation (no write, no HTTP, no secret input)

In a PowerShell terminal, substitute your local source path, existing `.env` path and an **already-approved** cloud hostname:

```powershell
& '<local-repo>\cloud-alerts\deploy\windows\Install-DailyTokenRelay.ps1' `
  -SourceDir '<local-repo>\cloud-alerts' `
  -ProtectedEnvFile '<existing-read-only-trading-folder>\.env' `
  -TokenEndpoint 'https://approved.example.com/internal/token'
```

This is *plan only*. It validates that the files exist, that the target is public HTTPS on port 443 with the exact `/internal/token` path, that Python resolves, and that sources aren't inside the protected trading folder. It does not read, log or transmit the access token.

## Installation requires a SECOND, explicit action

After independent host/cost/security review, rerun the same command with **both** `-Install -ConfirmApprovedHost`. It prompts for the API key and a relay HMAC secret (HMAC input hidden). **Do not paste either into a shell command or GitHub file.**

The installer creates only `%LOCALAPPDATA%\NiftyReadOnlyTokenRelay\`, protects the directory/config using the current Windows user's ACL, encrypts the relay HMAC secret using Windows user-scoped **DPAPI**, and registers one *low-privilege, current-user, at-logon* task named `NiftyReadOnlyDailyTokenRelay`. It refuses to replace an existing task. It does not run the task immediately or read the protected `.env` contents. It does not store the access token or Kite API secret.

On the next user sign-in, `Watch-DailyToken.ps1` decrypts the local relay secret for that Windows user, passes it to the existing Python `cloud_alerts.token_sender --watch` through its process environment, and watches only the `.env` file's two needed Kite variables. The watcher does not launch the user's trading application or change its files. A Windows account or process with the same user's privileges can potentially inspect runtime environment variables; protect the account and disk as well as the DPAPI ciphertext.

## Acceptance before switching off Nirala

- Verify the user-logon task is running under the expected unprivileged account. A successful Task Scheduler launch **does not** prove the relay worked.
- Complete legitimate Zerodha login and allow the protected project's existing code to refresh the token.
- Require the watcher's sanitized `Token handoff accepted by cloud` output, confirm the approved host reports a current `readyz` token status through private operator access, and validate real Kite GET requests; then TEST-only Telegram to the phone. Do not rely on the local watcher success line alone.
- Keep cloud BUY alerts disabled until the test receipt and all read-only market-data checks pass. Never store broker/Telegram/HMAC secrets in public GitHub or commands.
- Task Scheduler `AtLogOn` is **not** a machine-level service: it does not watch files while the PC is off or nobody is signed in. A logged-in user session is required. If Python exits, the watcher stops; this installer does not claim automatic task restart or unlimited uptime.

To stop future automatic starts (requires deliberate user action):

```powershell
Disable-ScheduledTask -TaskName 'NiftyReadOnlyDailyTokenRelay'
```

To remove the task after disabling, use Windows Task Scheduler or `Unregister-ScheduledTask -TaskName 'NiftyReadOnlyDailyTokenRelay' -Confirm`. The private config remains in LocalAppData until **manually** cleaned up. No removal procedure should alter the user's protected trading folder.

## Boundaries

- **No cloud VM, HTTPS domain, Telegram phone receipt, Windows Task Scheduler execution, or real daily access token transfer has been verified by these files.** This is deployment *preparation only*.
- PowerShell syntax and DPAPI behavior require testing on an authorized Windows machine *after approval*; a Linux static test cannot substitute for Windows execution.
- No real Zerodha orders, trading automation, credential harvesting, or direct broker authentication is implemented.
