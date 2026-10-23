# Phase 47 — Azure for Students connection preparation and safe account inspection

**Date:** 2026-10-23. **Status:** Developer CLI installed, actual Azure for Students subscription **NOT VERIFIED**, **no VM/resource created**, **no paid plan or budget change**.

## Verified operations on Nirala

1. Used the authorized Desktop Commander connection to inspect installed cloud tools without reading personal browser data, passwords, or the protected `Automation Day Trading` folder. Prior to this phase, neither `az` nor `oci` existed, nor did Azure/OCI CLI credential configuration.
2. Opened the official [Azure for Students offer](https://azure.microsoft.com/en-in/free/students/) in Nirala's default browser. The user must sign in using their own eligible academic account and complete student verification. The account's offer was **not activated by the agent**.
3. Installed official **Microsoft Azure CLI 2.91.0** on existing Ubuntu 24.04 WSL2 through Microsoft's GPG-signed apt repository. Install exit code **0**; confirmed working as the non-root `indicatorqa` account. Installation creates local software only; it did not create an Azure resource or incur an Azure charge.
4. Initiated the official `az login --use-device-code --allow-no-subscriptions` flow, opening Microsoft's device login page for the user. The login process terminated with exit 0, but a subsequent **actual `az account list` returned an empty list**, and `az account tenant list` requested login. Therefore **do not claim a connected Azure subscription or confirmed account authentication**. No temporary device code, user email, tenant ID, subscription ID or CLI credential was committed.
5. Added `cloud_alerts.azure_student_audit`. It executes only `az account list --all` and Azure Resource Manager `GET /subscriptions/{id}` for valid enabled subscriptions to check whether the offer quota ID is Azure for Students. Its report excludes user identifiers, emails and subscription IDs and **never authorizes deployment**. This is a *read-only offer classification*, not a credit-balance check or proof of a usable covered VM/IP/disk.
6. Added synthetic tests for inactive and pay-as-you-go subscriptions, missing login, invalid account lists and IDs, API failures, false claims, and secret redaction: **8/8 PASS** on Ubuntu Python 3.12.
7. Entire current branch regression **616 passed, 0 failed, 1 skipped, 1 non-fatal Starlette/httpx deprecation warning**, exit **0**, in 24.38 seconds, using the non-root WSL offline regression script. No real Kite/Telegram credentials were injected, and no orders or messages were sent.

## Exact human-only account verification step

In the existing browser tab, visit **https://azure.microsoft.com/en-in/free/students/**; press `Start free` and sign in as the eligible higher-education student. Complete the institution email verification, consent and Microsoft account MFA yourself. Don't send passwords or one-time codes into the chat. Do **not** select standard pay-as-you-go or add a payment card. Azure for Students advertises **$100 credit over 12 months** and no card at sign-up, but eligibility and individual subscription activation must be verified inside Microsoft.

After activation, authorize a **new** device login session from the local Ubuntu Azure CLI when initiated in the chat. Then use the actual saved read-only CLI:

```powershell
wsl -d Ubuntu-24.04 -- env -i HOME=/home/indicatorqa PATH=/usr/bin:/bin LANG=C.UTF-8 PYTHONPATH=/home/indicatorqa/work/indicator-setup/cloud-alerts /home/indicatorqa/work/.venv/bin/python -m cloud_alerts.azure_student_audit --json
```

An authenticated account with no active verified Student subscription remains `BLOCKED`. A structurally confirmed Student offer returns `STUDENT_OFFER_VERIFIED_READ_ONLY`, explicitly with `student_credit_balance_verified:false` and `approved_to_deploy:false`.

Independently inspect remaining credit/expiry in [Azure Sponsorships](https://www.microsoftazuresponsorships.com/balance), and VM region availability, EBS-like disk costs, IP, outbound traffic, quota and credit cap. **Azure for Students is a finite $100 subsidy, not a perpetual ₹0 always-on VM guarantee**. If credit is exhausted or the offer expires, Microsoft disables the subscription rather than silently upgrading it to pay-as-you-go unless the user chooses that upgrade. Do not provision without the reviewed exact host and user approval.

## Project acceptance unchanged

The Render Free services reviewed earlier sleep and lack persistent local storage. Oracle sign-up requires identity/payment-card verification and was not initiated. Current Indicator cloud deployment, real Kite access-token handoff, actual options depth, Telegram phone receipt while Nirala is OFF, and five NSE paper sessions remain **0/5 confirmed**. `ALERTS_ENABLED=false`, `PAPER_AUTOTRADE_ENABLED=false`, no real broker orders. The legacy expanded engineering progress estimate remains **53%**, not a profitability claim.

Sources: Microsoft's [Azure for Students overview](https://learn.microsoft.com/azure/education-hub/about-azure-for-students) and [Azure Education FAQ](https://learn.microsoft.com/en-us/azure/education-hub/faq).
