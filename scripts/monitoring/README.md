# Cloud Monitoring alerting (oww-maco)

Infra-as-code for GCP alert policies. The goal is that **operational failures
reach a human**, instead of silently sitting in Cloud Logging — the lesson from
the `autoAcknowledgeBills` `FAILED_PRECONDITION` that ran nightly, logged an
ERROR every time, and went unnoticed for days.

## Function-error alert (implemented)

`function-errors.alert-policy.json` — a log-based alert that fires when **any
Cloud Function logs `severity >= ERROR`**. Because the scheduled crons
(`autoAcknowledgeBills`, `dailyMembershipMaintenance`, `monthlyBillRun`,
`staleCheckoutReminders`, `retryBillProcessing`, `cleanupAbandonedCheckouts`)
log an error when they fail, this one policy covers every silent-cron scenario.
Rate-limited to one notification per 30 min so a flapping function can't spam.

### Set it up

```bash
scripts/monitoring/setup.sh --email ops@werkstattwaedi.ch --project oww-maco
# staging too, if wanted:
scripts/monitoring/setup.sh --email ops@werkstattwaedi.ch --project oww-maco-staging
```

The script creates (or reuses) an email notification channel and applies the
policy. **Confirm the verification email** Google sends to the address, or the
channel stays unverified and won't notify.

### Verify / tune

- Test the filter first in the Logs Explorer:
  `resource.type="cloud_run_revision" AND labels."goog-managed-by"="cloudfunctions" AND severity>=ERROR`
- If a function logs *expected* errors (handled cases logged at ERROR), either
  lower those to WARNING in code or add an exclusion to the filter — otherwise
  they'll page. Prefer fixing the log level.

## Still to add (not yet implemented)

Tracked here so the roster is explicit:

- **Uptime checks** on the checkout + admin hosting and `GET /api/ping`, with a
  downtime alert.
- **Budget alert** on the billing account (the CLAUDE.md free-tier posture is
  manual dashboard-watching today).
- **Gateway / terminal liveness** — needs the device→cloud telemetry work
  (post-launch); alert when a terminal or the gateway goes dark during opening
  hours.
- **Client-error spikes** — once `logClientError` is reshaped into GCP Error
  Reporting (post-launch).
