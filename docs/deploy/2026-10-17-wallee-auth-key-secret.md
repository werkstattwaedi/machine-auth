---
phase: before-functions
---

# Create the `WALLEE_AUTH_KEY` secret (ADR-0051)

**What:** the new functions `walleeWebhook` and `reconcileTerminalPayments`
bind the Functions secret `WALLEE_AUTH_KEY` (the Wallee application user's
authentication key, base64). A functions deploy fails with "no value for the
secret" until it exists in the project.

Staging and prod share one Wallee space, so the key is a **shared** secret
(the same value in both projects, like `TERMINAL_KEY`). Set it in prod and
copy it to staging:

```bash
# prod — paste the key from the Wallee portal (Account → Application users)
firebase functions:secrets:set WALLEE_AUTH_KEY --project oww-maco
# staging — copy prod's value
gcloud secrets versions access latest --secret=WALLEE_AUTH_KEY --project=oww-maco \
  | firebase functions:secrets:set WALLEE_AUTH_KEY --project oww-maco-staging --data-file=-
```

If the key isn't at hand yet, a placeholder lets the deploy through: the
terminal stays switched off until the operations config sets
`wallee.spaceId`, `wallee.userId`, `wallee.terminalId` and
`wallee.referencePrefix`, and the method is in `web.paymentMethodsKiosk`.
Use `printf placeholder | firebase functions:secrets:set WALLEE_AUTH_KEY --project <project-id> --data-file=-`
and replace it before enabling the terminal.

**Check (and already done?):**
`gcloud secrets versions list WALLEE_AUTH_KEY --project=<project-id>` lists at
least one enabled version. If it does, there is nothing to do.

**Without it:** `firebase deploy --only functions` aborts before any
function is updated. Nothing breaks at runtime, but the release doesn't go
out.

Enabling the terminal later (not part of this step): the operations config
keys above plus `kiosk.terminal.{host,port,posId}`, then
`npx tsx scripts/wallee-webhook-setup.ts --project <project-id> --dry-run`
and without `--dry-run` — see `docs/deployment-checklist.md` §1 and §2.
