# Deployment Checklist

Steps to deploy the full system to production.

## TL;DR — one-shot deploy (no gateway/kiosk)

```bash
npm run deploy:staging          # functions + rules + hosting → oww-maco-staging
npm run deploy:prod             # same → oww-maco (asks for confirmation)
scripts/deploy/deploy.sh staging prod  # both, staging first
```

`scripts/deploy/deploy.sh` chains generate-env, the functions deploy wrapper,
`firestore,storage`, and hosting (with `WEB_BUILD_SCRIPT=build:staging` on
staging) — always passing `--project` explicitly. It does NOT cover the
gateway, the kiosk, or the manual steps below (secrets, custom claims,
smoke tests).

### Latest main only, and the deploy record (ADR-0045)

Every deploy path (`deploy.sh`, the gateway deploy, the kiosk build,
`./pw prod-flash`) first checks that machine-auth and the operations repo
are on `main`, up to date with `origin/main` and without uncommitted
changes (gateway/firmware: submodules too) — and refuses otherwise. To
deploy a branch on purpose: `--allow-off-main` or `DEPLOY_ALLOW_OFF_MAIN=1`;
the record then says "off main" and why.


Then each of them names the **release** it ships (`scripts/deploy/release.ts`):
a commit that was deployed before reuses its `vYYYY.M.N` tag; a new commit
gets the next number of the month (`v2026.10.3`) after one question that
lists the commits since the previous release — and the operations config
commits, if the config changed. For `deploy.sh prod` that question replaces
"Deploy to PRODUCTION?". `--yes` answers it (`./pw prod-flash --yes`,
`npm run build:kiosk:prod -- --yes`); without a terminal it refuses. A
config-only change keeps the version unless you ask for a new one with
`--new-release`. Off-main or dirty deploys never cut a release; they ship
a `-dev` version. Every component reports that version: the pings
(`/api/ping`, the dispatchers' `ping`), the web apps' `/version.json` and
the admin sidebar, the kiosk tray, the gateway's `VERSION` file and the
firmware's `GetDeviceInfo`. `git show v2026.10.3` shows the release notes.

**Device status (ADR-0045 phase 2c).** Rolling it out: functions first
(`/api/device-status`, `reportKioskStatus`), then the gateway (until then it
logs "report failed" and retries), then firmware and kiosk whenever they
next ship — older firmware and kiosks just report less. Only once the
gateway reports, create the two alert policies from the operations repo's
`docs/monitoring.md` ("Gateway heartbeat missing", "Terminal offline");
created earlier, the first one fires at once.

After every deploy, the record step reads what the devices report (the
`status` documents of both projects) into STATE.md's "Running (live)"
section and warns about devices on an older release or offline. It needs
Application Default Credentials (`gcloud auth application-default login`);
without them STATE.md just says the live view was unavailable. The same
view, live, is the admin app's **Versionen** page.

Every successful `deploy.sh` run, gateway deploy, kiosk installer build and
`./pw prod-flash` records itself: a `deploy/<env>/<component>/<timestamp>`
git tag plus an entry in the operations repo's `deploys/log.jsonl`, from
which its `STATE.md` (what runs where) is regenerated. Log every manual
step from this checklist the same way:

```bash
npx tsx scripts/deploy/deploy-record.ts event --env prod --note "ran migrate-bill-numbers.ts"
git log "$(git tag -l 'deploy/prod/firebase/*' | tail -1)"..origin/main --oneline   # not in prod yet
```

If a record step warns (e.g. offline), re-run it by hand —
`npx tsx scripts/deploy/deploy-record.ts deploy --env <env> --component <component>`.

### One-off deploy steps (ADR-0049)

A change that needs a **migration** around the deploy, in order — a data
migration or backfill, a data gate, a mail-template publish, a config
parameter that is required from now on, a console switch — ships it as a
file in [`docs/deploy/`](deploy/README.md), and `scripts/deploy/deploy.sh` stops
for it: before the functions deploy, after it, or after everything, as the
file's `phase:` says. A step is pending for an environment when its file
was added since that environment's last deploy tag — the migrations the
PRs merged since then declared in their `Deploy:` line. The script hands
the pending files to an interactive agent session — or prints them with
`--no-agent`, without a terminal, or inside Claude Code — and asks once
whether they are done. `--yes` does not answer that. Declining at the last
boundary leaves the deploy unrecorded on purpose, so the step comes back.

```bash
npx tsx scripts/deploy/deploy-steps.ts list --env prod     # what the next deploy stops for
```

A step migrates an environment that already runs; **this checklist builds
a fresh one**, and after the step both must match. So a change that also
needs something on a fresh installation updates this document in the same
PR, and this document carries no migration history: the rollouts before
ADR-0049 are done in both environments and their sections are gone, while
`docs/deploy/` keeps every step from now on — another installation of
this repo may deploy from an older tag. The BigQuery schema needs no step:
`setup-bigquery.ts` runs before every functions deploy (idempotent; needs
`gcloud auth application-default login`, and the deploy stops without it).

## Prerequisites

- Firebase CLI authenticated: `firebase login`
- Correct project selected: `firebase use oww-maco`
- `gcloud` authenticated against the same project (needed for gateway secrets)
- Operations repo cloned as a sibling of `machine-auth/`

## Staging deploys (ADR-0034)

Staging (`oww-maco-staging`) is deployed with the same steps as production,
with these deltas — never `firebase use`; always pass `--project` explicitly:

```bash
# Regenerate staging env files after any operations-config change
# (config.staging.jsonc overlays config.jsonc; also emits
# maco_gateway/.env.staging with secrets fetched via gcloud):
npx tsx scripts/generate-env.ts --env staging

# Functions:
cd functions && npm run deploy -- --project oww-maco-staging

# Firestore / Storage rules:
firebase deploy --only firestore,storage --project oww-maco-staging

# Hosting — WEB_BUILD_SCRIPT is required, otherwise the predeploy ships
# prod-configured bundles to the staging sites:
WEB_BUILD_SCRIPT=build:staging firebase deploy --only hosting --project oww-maco-staging

# Gateway — local run against staging:
npm run dev:gateway:staging
# …or deploy a test Pi against staging (config.staging.jsonc sets
# printerHost: "" so the print worker stays off — it would otherwise
# consume PROD print jobs via the prod GATEWAY_FIRESTORE_SA key):
npx tsx scripts/deploy/deploy-gateway.ts --env staging --host maker1@<test-pi>.internal

# Kiosk (local Electron for integration testing / packaged build):
cd checkout-kiosk && npm run start:kiosk:staging   # or build:kiosk:staging
```

Secrets are **shared with production** (same Secret Manager values, copied
into the staging project — see ADR-0034) — **except `KIOSK_BEARER_KEY`**,
which has its own value per project (the smoke test holds the staging one,
so it must open nothing in prod). After rotating any *shared* secret in
prod, re-copy it:

```bash
gcloud secrets versions access latest --secret=<NAME> --project=oww-maco \
  | firebase functions:secrets:set <NAME> --project oww-maco-staging --data-file=-
```

Giving staging its own kiosk bearer (one-time, and again to rotate it):

```bash
# `tr -d '\n'` matters: --data-file=- stores stdin VERBATIM, and a bearer
# saved with openssl's trailing newline matches nothing a client sends.
openssl rand -hex 32 | tr -d '\n' | firebase functions:secrets:set KIOSK_BEARER_KEY \
  --project oww-maco-staging --data-file=-
cd functions && npm run deploy -- --project oww-maco-staging   # pins the new version
cd ../checkout-kiosk && npm run build:kiosk:staging           # bakes it into the staging kiosk
```

### Staging-only test tooling: `mintTestTap`, `uploadTestUsage`

Both hooks back the agent smoke run (§8), share two guards
(`functions/src/testing/staging_guard.ts`) and add one of their own.

`mintTestTap` mints the `picc`/`cmac` of a badge tap for a **virtual** tag so
the post-deploy smoke test can run the kiosk flows without a reader or the tag
keys. It forges taps with keys production shares, so it is fenced three ways
(`functions/src/testing/mint_test_tap.ts`): it is exported only when the deploy
target is `oww-maco-staging` and answers 404 anywhere else; it is
`invoker: "private"` (Google identity token of a principal with `run.invoker`)
and additionally wants the staging kiosk bearer; and it only mints for UIDs
starting with `f0` — real NXP tags start with `04`.

`uploadTestUsage` reports a finished machine session (`uid`, `machineId`,
`activeSeconds`, optional `wallClockSeconds`) to the **real**
`handleUploadUsage`, so the run can look at what a laser session does to a
member's cart without a terminal. Same staging-only export and private
invoker + bearer; its own guard is that it only bills an account of the smoke
mailbox (`users.email` starts with `smoke.testing+`) on a machine that exists
(`functions/src/testing/upload_test_usage.ts`). The runbook calls it as
`npm run agent -- usage add <uid> <machineId> <activeSeconds>`.

`scripts/deploy/deploy.sh prod` fails if either function is ever found in production.

```bash
# Smoke-check it after a staging deploy (prints {"picc":…,"cmac":…}):
URL=$(gcloud functions describe mintTestTap --gen2 --region europe-west6 \
  --project oww-maco-staging --format='value(serviceConfig.uri)')
curl -s -X POST "$URL" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -d "{\"uid\":\"f0000000000001\",\"counter\":1,\"bearer\":\"$(gcloud secrets versions \
       access latest --secret=KIOSK_BEARER_KEY --project=oww-maco-staging)\"}"
```

A 403 from Google (HTML, before our code runs) means the caller lacks
`roles/run.invoker` on the service; grant it — on **both** services — to the
people who run the smoke test, never to `allUsers`.

One-time setup on a fresh clone: apply the staging hosting targets (prod
`generate-env` preserves foreign-project target entries in `.firebaserc`,
so this survives regeneration):

```bash
firebase target:apply hosting checkout oww-maco-staging --project oww-maco-staging
firebase target:apply hosting admin oww-maco-staging-admin --project oww-maco-staging
```

## 0. Predeploy (automation)

Build every deployable artifact in one shot:

```bash
npm run predeploy
```

Runs: `firebase use` check → `generate-env` → install+build for `functions/`,
`web/`, the gateway payload (Bazel + .env from gcloud secrets), and
`checkout-kiosk/` (electron-rebuild). After this completes, the deploy
steps below are mechanical — the build outputs they need already exist.

This does NOT rotate secrets, re-save admin docs to refresh custom
claims, or run smoke tests. Those manual steps still apply.

## 1. Secrets

Set all required secrets:

**Firebase Functions secrets** — the authoritative list is whatever
`defineSecret(` appears in `functions/src`
(`grep -rho 'defineSecret("[^"]*")' functions/src | sort -u`); a missing
one fails the deploy with "no value for the secret". Currently:

```bash
firebase functions:secrets:set DIVERSIFICATION_MASTER_KEY
firebase functions:secrets:set GATEWAY_API_KEY
firebase functions:secrets:set KIOSK_BEARER_KEY
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set TERMINAL_KEY
# Wallee application user's auth key (ADR-0051), shared by staging and prod
# (one Wallee space). A placeholder is fine until the terminal is enabled
# (see "Wallee payment terminal" below).
firebase functions:secrets:set WALLEE_AUTH_KEY
# Stats subject-key salt (ADR-0039) — generate with `openssl rand -hex 32`,
# DIFFERENT value per project (staging vs prod). Destroying this secret is
# the retroactive-anonymization switch for all BigQuery stats rows.
# `tr -d '\n'` matters (same trap as KIOSK_BEARER_KEY): the stored bytes ARE
# the salt. The current salts in both projects predate this and DO end in a
# newline — leave them: changing the bytes re-keys every subject. Only a
# deliberate rotation (which re-keys anyway) should drop it.
openssl rand -hex 32 | tr -d '\n' | firebase functions:secrets:set STATS_SUBJECT_SALT --data-file=-
```

Non-secret params with built-in defaults need no action unless you want to
tune them — e.g. `KIOSK_ELEVATION_TTL_MS` (kiosk step-up lifetime, ADR-0041,
`functions.kioskElevationTtlMs`, default 15 min). Rules changes that gate on
the `elevatedUntil` claim ship with the regular rules deploy.

Verify: `firebase functions:secrets:access GATEWAY_API_KEY`

**Google Cloud Secret Manager (gateway):**

```bash
gcloud config set project <your-project-id>
echo -n "$(openssl rand -hex 16)" | gcloud secrets create GATEWAY_ASCON_MASTER_KEY --data-file=-
```

See [`config.md`](config.md#maco-gateway-configuration) for details.

## 2. Environment Config

String parameters (`DIVERSIFICATION_SYSTEM_NAME`, `LOGIN_*`, …) are
`defineString` params read from `functions/.env.<projectId>`
at deploy time — they are NOT set via the deprecated `functions:config:set`.

After editing `machine-auth-operations/config.jsonc`, run `npm run generate-env` from the repo root to refresh `functions/.env.<projectId>` (and the web/maco_gateway env files) before deploying. Otherwise newly-added Firebase Functions params (e.g. `LOGIN_ALLOWED_ORIGINS`, `RESEND_TEMPLATE_ENV`) will be missing from the deployed environment and login will silently break.

Verify `config/pricing` exists in Firestore (Admin → Firestore → `config/pricing`). Per issue #149 the checkout UI and the `closeCheckoutAndGetPayment` function refuse to operate when the doc is missing or fails the shape check, so a missing doc breaks all checkouts loudly rather than silently misbilling with hardcoded fallbacks.

Verify `config/billing` carries `referenceNumberFormat: "shifted-v1"` next
to `nextBillNumber` (ADR-0042). `allocateBill` refuses to mint
(`failed-precondition`) while the doc exists without that marker, so a seed
that writes only `nextBillNumber` breaks every bill. The marker came with
the 2026-09 bill-number migration and stays required until the legacy
QR-slip fallback in the bank import can go (#764) — not yet.

Verify `config/catalog-references` carries **both** references (ADR-0030):
`membership` and `badge`, each pointing at an active catalog doc. The badge
SKU must have the two variants `standard` (5 CHF) and `gratis` (0 CHF) —
`addBadgeToCheckout` refuses with `failed-precondition` otherwise, which
breaks the kiosk self-service badge purchase. The public seed
(`scripts/seed-data/catalog/badge.json`) is the reference shape; production
data comes from the operations repo's catalog fixtures, so add the badge
item there before deploying this feature.

### SMS login codes (ADR-0031)

Rolling out SMS login needs three switches, in this order:

1. **Firebase console → Authentication → Sign-in method → Phone: enable.**
   Also verify the checkout domain is in Authentication → Settings →
   Authorized domains (reCAPTCHA for phone auth checks it). SMS billing
   applies (~6¢/SMS, Blaze).
2. Optionally restrict SMS regions to CH (Authentication → Settings →
   SMS region policy) to keep abuse costs bounded.
3. Set `web.smsLoginEnabled: "true"` in the operations config and run
   `npm run generate-env` — this feeds `VITE_SMS_LOGIN_ENABLED` into the
   checkout build, turning on the "E-Mail oder Handynummer" field and the
   profile verification affordance. Without step 1 the flag-on flow fails
   at `signInWithPhoneNumber`, so flip the flag last.

Smoke test after deploy: verify a phone number on `/account/profile`
(one SMS), then sign in with it on `/checkin`. On the kiosk, confirm the
session lands as the ephemeral actsAs principal (the header shows no
account avatar and "Besuch starten" appears).

### Wallee payment terminal (ADR-0051)

Optional — the kiosk works without it. Paying "Karte / TWINT" at the A35
next to the kiosk needs, in this order:

1. **Operations config:** `wallee.spaceId`, `wallee.userId`,
   `wallee.terminalId` (the Wallee *backend* terminal id, not the EP2 id
   the terminal prints), `wallee.referencePrefix` (`P` for prod, `S` for
   staging — they share the space and must differ), and the kiosk's
   `kiosk.terminal.{host,port,posId}`. Run `npm run generate-env`.
   Any empty `wallee.*` value keeps the terminal switched off.
2. **The `WALLEE_AUTH_KEY` secret** with the real key (§1), then deploy
   functions.
3. **Webhook registration** (idempotent; also re-activates a listener
   Wallee deactivated):
   ```bash
   npx tsx scripts/wallee-webhook-setup.ts --project <project-id> --dry-run
   npx tsx scripts/wallee-webhook-setup.ts --project <project-id>
   ```
4. **Offer it:** add `wallee_terminal` to `web.paymentMethodsKiosk` (first
   in the list puts its card on top), `npm run generate-env`, deploy
   functions and hosting, and build the kiosk (`npm run build:kiosk:<env>`)
   so it knows the terminal's address.

Smoke test on staging with the test acquirer: CHF 3.00 approves, CHF 1.00
declines (`docs/plans/wallee-terminal.md`). The checkout must close within
seconds of the tap and the Quittung mail must say "Bezahlt … via
Karte/TWINT (Terminal)" with the terminal receipt block in the PDF.

### Transactional mail templates (ADR-0046)

Every mail the functions send is a Resend template generated and published
from the operations repo (`email/`), addressed as `<env>-<mail>[-<dim>…]`
per `shared/src/email-contract.ts`. `functions.resendTemplateEnv` (`prod` /
`staging`) feeds `RESEND_TEMPLATE_ENV`; an unset or unknown value fails
every send loudly (`failed-precondition`, bill mails into
`operations_log`), it does not block the deploy.

**Whenever the contract changed** (a mail, dimension or variable added or
renamed), before the functions deploy of each project — the PR that changes
it ships this as a `before-functions` step in `docs/deploy/` (ADR-0049).
On a fresh installation, publish both environments once before the first
functions deploy:

```bash
cd ../machine-auth-operations
export RESEND_API_KEY=$(firebase functions:secrets:access RESEND_API_KEY -P oww-maco)
npm run email:publish -- --env staging   # then: --env prod
```

Publishing is additive, so the still-running functions keep their
aliases. After the deploy has settled, `npm run email:publish -- --env
<env> --prune` removes aliases nothing uses any more. A copy-only change
needs no functions deploy at all.

Smoke test for the kiosk account-instructions mail (issue #595): sign up
with a fresh e-mail at the kiosk (`/checkin?kiosk`) — the visitor should
land identified (identity strip) and receive the instructions email; an
unclaimed member's e-mail should sign in with a code and get the 4-step
"Willkommen" onboarding overlay (step 4 offers the same instructions
email).

## 3. Deploy Functions

```bash
npm run deploy:functions
```

The wrapper packs `@oww/shared` into `functions/` and rewrites
`functions/package.json` to point at the tarball before invoking
`firebase deploy --only functions`, then restores both on exit.
Running `firebase deploy --only functions` directly also works (the
predeploy hook does the same prep), but leaves the dirty state behind —
run `npm run deploy:functions:cleanup` afterwards. The Husky pre-commit
hook refuses commits while the dirty state is in effect.

Verify: Check Functions logs in Firebase Console for startup errors.

## 4. Deploy Firestore + Storage Rules and Indexes

```bash
firebase deploy --only firestore,storage
```

This covers Firestore rules **and indexes** (collection-group queries need
their fieldOverrides deployed to every project — the emulator doesn't
enforce them) plus Storage rules. `scripts/deploy/deploy.sh` runs the same command.

Verify: The `isAdmin()` rule now checks `request.auth.token.admin == true` (custom claims).

## 5. Set Custom Claims for Existing Admins

The `syncCustomClaims` trigger fires on user doc writes. For existing admin users, trigger it by re-saving the document (e.g., via the web admin UI or Firebase Console).

Verify: In Firebase Console > Authentication > Users, click a user and check Custom Claims shows `{"admin": true}`.

## 6. Deploy Web Apps

```bash
cd web
npm install
npm run build
firebase deploy --only hosting
```

This deploys both the checkout and admin sites. To deploy individually:

```bash
firebase deploy --only hosting:checkout
firebase deploy --only hosting:admin
```

Verify: Visit both checkout and admin hosting URLs.

## 7. Full Deploy (all at once)

```bash
firebase deploy
```

## 8. Smoke run

**Staging: an agent walks the apps.** `/smoke-staging` in Claude Code sends an
agent through `machine-auth-operations/smoke/RUNBOOK.md` against the *deployed*
staging apps: it uses them step by step, **looks at every screenshot**, reads
the real mails and the invoice PDF as images, and writes a report with a
verdict. It exists for what the emulator structurally cannot show — missing
indexes, races hidden by instant commits, IAM/secrets/allowed-origins, bundles
built for the wrong project, real mail delivery — and for what no scripted
check anticipates: its first run found an invoice PDF without a recipient and
"Seite 1 / 1" on a two-page document. There is deliberately no scripted smoke
suite; the emulator e2e is the regression net.

Run it **by choice**: after a staging deploy that changes anything a person
sees, and before the production deploy that follows — or for single scenarios
("/smoke-staging only H and I"). Scenarios: sign-up and login by mailed code,
visit → bill → invoice mail, a deleted Auth record healing (#633), guest
checkout, account + membership at the kiosk, badge purchase / badge login / the
badge price rule, family membership with both invitation flows, a cart filled via QR targets, a backend-uploaded laser
session and every pricing unit, an admin e-mail change. It needs
`gcloud auth login` + `gcloud auth application-default login` with staging
access, and refuses the production project.

**Still by hand** (after a deploy that touches them):

1. **Google sign-in** — real Google blocks automation (its guard is covered in
   the emulator e2e).
2. **TWINT** — the agent's visits end on the QR-bill method.
3. **A physical badge on the physical kiosk** — after a kiosk rebuild: tap,
   confirm the session, check out.
4. **Terminal check-in** — a MaCo terminal end to end.
5. **Production** — no smoke run there: load both apps, sign in once, confirm
   the admin site demands the admin claim.

## 9. BigQuery statistics + data protection (ADR-0038 / ADR-0039)

One-time per project (staging first, then prod). See
[`data-protection.md`](data-protection.md) for the operating procedures.

**9a. BigQuery dataset + IAM:**

```bash
# Dataset, tables, dedup views (idempotent; re-run after schema changes):
npx tsx scripts/deploy/setup-bigquery.ts --project <project-id>

# Functions runtime SA needs dataset write + job run:
SA="<project-id>@appspot.gserviceaccount.com"   # or the configured runtime SA
bq add-iam-policy-binding --member="serviceAccount:${SA}" \
  --role="roles/bigquery.dataEditor" "<project-id>:stats"
gcloud projects add-iam-policy-binding <project-id> \
  --member="serviceAccount:${SA}" --role="roles/bigquery.jobUser"
```

**9b. Invoice archive bucket (PDF escrow):**

```bash
# Archive-class bucket, uniform access, europe-west6:
gcloud storage buckets create gs://<project-id>-invoice-archive \
  --project=<project-id> --location=europe-west6 \
  --default-storage-class=ARCHIVE --uniform-bucket-level-access

# Functions SA: WRITE ONLY (objectCreator). Reading archived PDFs is a
# break-glass IAM grant, removed after use.
gcloud storage buckets add-iam-policy-binding gs://<project-id>-invoice-archive \
  --member="serviceAccount:${SA}" --role="roles/storage.objectCreator"

# IAM BASELINE CHECK — objectCreator does not SUBTRACT broader grants.
# Verify the runtime SA holds no project-level role with storage.objects.get
# (the default compute SA's legacy Editor role does!). If it does, either
# remove that grant or switch functions to a dedicated least-privilege SA:
gcloud projects get-iam-policy <project-id> \
  --flatten="bindings[].members" --filter="bindings.members:${SA}" \
  --format="table(bindings.role)"

# Lifecycle: expire archived PDFs 10 years after the bill's paid date.
# The move stamps customTime = paidAt, so age is legal age, not move date:
cat > /tmp/archive-lifecycle.json <<'EOF'
{"rule": [{"action": {"type": "Delete"},
           "condition": {"daysSinceCustomTime": 3650}}]}
EOF
gcloud storage buckets update gs://<project-id>-invoice-archive \
  --lifecycle-file=/tmp/archive-lifecycle.json

# Data-access audit logging for the archive bucket (break-glass evidence):
# enable "Cloud Storage – Data Read" audit logs for the project in
# IAM & Admin → Audit Logs (or via the project IAM policy).
```

**9c. Backfill + verification gate** (BEFORE first use of erase/trim):

```bash
# The script fetches STATS_SUBJECT_SALT itself (byte-exact). Never pass it
# via STATS_SUBJECT_SALT="$(gcloud …)": the shell strips the stored
# trailing newline and every row gets a different subject_key than the
# daily export's (scripts/stats-salt.ts).
FIREBASE_PROJECT_ID=<project-id> \
  npx tsx scripts/backfill-stats.ts --prod

# Verify (record the numbers in the PR / ops log):
#  - Firestore counts vs `SELECT COUNT(*) FROM stats.visits_v` etc.
#  - SUM(summary.totalPrice) vs SELECT SUM(total_price) FROM stats.visits_v
#  - 5 random checkouts field-by-field
```

**9d. Ops calendar:** January = yearly retention trim
(`privacy-cli.ts trim --dry-run --prod` → review counts → live run). See
[`data-protection.md`](data-protection.md#ops-calendar).

## Gateway Deployment

The gateway runs separately on a Raspberry Pi (not on Firebase). Use the deploy script:

```bash
npx tsx scripts/deploy/deploy-gateway.ts --host maker1@maco-gateway.internal
```

This builds the gateway-service + pw_rpc protos via Bazel, stages a small payload (gateway sources + generated protos + vendored pigweed Python sources + a pinned `requirements.txt`), generates the `.env` from `config.jsonc` and Google Cloud Secret Manager (including `GATEWAY_ASCON_MASTER_KEY`), and deploys to the target host. On the host, the script ensures a Python 3.11 venv at `~/gateway/venv` and runs `pip install -r requirements.txt`.

Start the gateway after deploy:

```bash
ssh maker1@maco-gateway.internal 'cd ~/gateway && venv/bin/python -m maco_gateway.main'
```

The Pi needs `python3.11` + `python3.11-venv` installed once (Raspberry Pi OS Bookworm ships them).

See `scripts/deploy/deploy-gateway.ts --help` for additional options (e.g., `--remote-dir`, `--build-only`).
