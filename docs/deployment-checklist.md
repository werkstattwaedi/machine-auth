# Deployment Checklist

Steps to deploy the full system to production.

## TL;DR — one-shot deploy (no gateway/kiosk)

```bash
npm run deploy:staging          # functions + rules + hosting → oww-maco-staging
npm run deploy:prod             # same → oww-maco (asks for confirmation)
scripts/deploy.sh staging prod  # both, staging first
```

`scripts/deploy.sh` chains generate-env, the functions deploy wrapper,
`firestore,storage`, and hosting (with `WEB_BUILD_SCRIPT=build:staging` on
staging) — always passing `--project` explicitly. It does NOT cover the
gateway, the kiosk, or the manual steps below (secrets, custom claims,
smoke tests).

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
npx tsx scripts/deploy-gateway.ts --env staging --host maker1@<test-pi>.internal

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

### Staging-only test tooling: `mintTestTap`

`mintTestTap` mints the `picc`/`cmac` of a badge tap for a **virtual** tag so
the post-deploy smoke test can run the kiosk flows without a reader or the tag
keys. It forges taps with keys production shares, so it is fenced three ways
(`functions/src/testing/mint_test_tap.ts`): it is exported only when the deploy
target is `oww-maco-staging` and answers 404 anywhere else; it is
`invoker: "private"` (Google identity token of a principal with `run.invoker`)
and additionally wants the staging kiosk bearer; and it only mints for UIDs
starting with `f0` — real NXP tags start with `04`. `scripts/deploy.sh prod`
fails if the function is ever found in production.

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
`roles/run.invoker` on the service; grant it to the people who run the smoke
test, never to `allUsers`.

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
# Stats subject-key salt (ADR-0039) — generate with `openssl rand -hex 32`,
# DIFFERENT value per project (staging vs prod). Destroying this secret is
# the retroactive-anonymization switch for all BigQuery stats rows.
firebase functions:secrets:set STATS_SUBJECT_SALT
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

After editing `machine-auth-operations/config.jsonc`, run `npm run generate-env` from the repo root to refresh `functions/.env.<projectId>` (and the web/maco_gateway env files) before deploying. Otherwise newly-added Firebase Functions params (e.g. `LOGIN_ALLOWED_ORIGINS`, `RESEND_LOGIN_TEMPLATE_ID`) will be missing from the deployed environment and login will silently break.

Verify `config/pricing` exists in Firestore (Admin → Firestore → `config/pricing`). Per issue #149 the checkout UI and the `closeCheckoutAndGetPayment` function refuse to operate when the doc is missing or fails the shape check, so a missing doc breaks all checkouts loudly rather than silently misbilling with hardcoded fallbacks.

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

### Kiosk sign-up + account-instructions email (issue #595)

The kiosk sign-up (`signupKiosk`) and the unclaimed-member offer
(`sendAccountInstructions`) send the `self-checkout-account-instructions`
Resend template. One-time setup before the functions deploy:

1. Create/publish the template from the operations repo
   (`email/account-instructions.html`; upload commands in
   `email/README.md` — remember `--subject` and `--var GREETING:string`).
2. The operations config carries
   `functions.resendAccountInstructionsTemplateId`
   (`self-checkout-account-instructions`); run `npm run generate-env` so
   `RESEND_ACCOUNT_INSTRUCTIONS_TEMPLATE_ID` lands in
   `functions/.env.<projectId>`. An empty param fails the send loudly at
   runtime (`assertTemplateConfigured`), it does not block the deploy.

Smoke test after deploy: sign up with a fresh e-mail at the kiosk
(`/checkin?kiosk`) — the visitor should land identified (identity strip)
and receive the instructions email; an unclaimed member's e-mail should
sign in with a code and get the 4-step "Willkommen" onboarding overlay
(step 4 offers the same instructions email).

### Membership-renewal invoice email (issue #323)

Renewal bills (`bill.source === "membership-renewal"`, minted by the
`renewalInvoicer` cron) send the `membership-renewal` Resend template.
One-time setup before the functions deploy:

1. Create/publish the template from the operations repo
   (`email/invoice-renewal.html`; upload commands in `email/README.md` —
   remember `--subject` and the four `--var` declarations).
2. The operations config carries
   `functions.resendMembershipRenewalTemplateId` (`membership-renewal`);
   run `npm run generate-env` so `RESEND_RENEWAL_TEMPLATE_ID` lands in
   `functions/.env.<projectId>`. If the param is unset, `pickTemplate`
   silently falls back to the generic QR-bill template — the email still
   sends, but with Self-Checkout copy instead of the Vorstand renewal
   letter, so this misconfiguration does NOT fail loudly.

### Bill correction + cancellation emails (ADR-0042)

Corrected re-issues (`RE-…-1`) and pure cancellations send two dedicated Resend templates.
One-time setup before the functions deploy:

1. Create/publish the templates from the operations repo — `self-checkout-correction`
   (variables: RECIPIENT_NAME, CHECKOUT_DATE, INVOICE_NUMBER, SUPERSEDED_INVOICE_NUMBER,
   DOCUMENT_KIND, AMOUNT, CURRENCY, REASON, KASSE_EMAIL, PAYMENT_NOTE (pre-composed "what to
   do about payment" sentence — new QR slip / TWINT already paid / next Sammelrechnung /
   nothing to pay), CORRECTION_DETAILS (pre-composed Sammelrechnung line, empty otherwise),
   CORRECTED_DOCUMENTS, CANCELLED_DOCUMENTS; the
   corrected PDF plus any corrected Belege are attached — HTML + upload commands live in the
   operations repo under `email/`) and
   `self-checkout-cancellation` (RECIPIENT_NAME, CHECKOUT_DATE, INVOICE_NUMBER, DOCUMENT_KIND,
   REASON, AMOUNT, CURRENCY, KASSE_EMAIL, PAYMENT_NOTE; no attachment).
2. Add `functions.resendCorrectionTemplateId` / `functions.resendCancellationTemplateId` to the
   operations config and run `npm run generate-env`.
3. Until both are set, the correction mail falls back to the generic QR-bill template and the
   cancellation notice fails into `operations_log` (retried hourly) — so set them before the first
   correction, not after.

### Bill-number migration (ADR-0042) — once per project, RIGHT AFTER the functions deploy

Stored `bills.referenceNumber` values move to `base × 10 + revisionDigit`. The new `allocateBill`
refuses to mint until `config/billing.referenceNumberFormat == "shifted-v1"` exists, and the daily
stats export emits a new `cancelled_at` column. Order matters — and it is **functions first**:

```bash
# 1. BigQuery first — the sink rejects unknown columns (skipInvalidRows: false).
npx tsx scripts/setup-bigquery.ts --project <project-id>

# 2. Deploy functions (section 3). From now on bill minting is BLOCKED
#    (failed-precondition) until step 3 runs — keep the gap short.

# 3. Dry-run, then migrate. Refuses to run twice; resumable per document.
FIREBASE_PROJECT_ID=<project-id> GOOGLE_APPLICATION_CREDENTIALS=<sa.json> \
  npx tsx scripts/migrate-bill-numbers.ts --prod --dry-run
FIREBASE_PROJECT_ID=<project-id> GOOGLE_APPLICATION_CREDENTIALS=<sa.json> \
  npx tsx scripts/migrate-bill-numbers.ts --prod

# 4. Then hosting (section 6); rules/indexes carry no change for this feature.
```

Why not migrate first: the *old* `allocateBill` would keep minting un-shifted numbers
(4200017 …) next to migrated ones, and every such bill is misread by the new formatter forever
(4200017 = base 420001, revision 8) with no way to rerun the migration. The new code refusing to
mint for a minute is the safe failure; a wrong number is not. Existing PDFs keep their printed
number and legacy QR payload; the bank import resolves those slips through a ×10 fallback.
Afterwards, check the admin Rechnungen list still shows `RE-4200001…`, close a test checkout to
confirm minting works again, and confirm a second `migrate-bill-numbers.ts` run refuses.

### Member identity (ADR-0043) — data gate BEFORE the functions + rules deploy

Login resolves by `users.email` and the Auth-linked phone must equal `users.phone`, both by exact
match. That is only safe while the stored values are clean, and the old admin profile tab can
still write any e-mail until the new **rules** are live — so check right before deploying:

```bash
# Read-only; prints counts and offender UIDs only, never an e-mail or phone. Exit 1 = findings.
FIREBASE_PROJECT_ID=<project-id> npx tsx scripts/check-user-identity-fields.ts --prod
```

It must report: every phone null or E.164, every e-mail null or trimmed+lowercase, **no e-mail
shared by two users docs** (after the deploy that is a hard login failure for both). Fix findings
by hand first. Then deploy functions **and** rules together (the rules pin `users.email` for
clients; the functions make the doc the login lookup key — either half alone leaves a gap), then
hosting (the admin profile tab now changes e-mails through `updateUserEmail`). Between the rules and
the hosting deploy the *old* profile tab gets "Keine Berechtigung" when an admin changes an e-mail
— the rules now pin `users.email` for admins too — so keep that gap short.

Afterwards backfill the drift that predates the sync — report first, read it, then fix:

```bash
npx tsx scripts/privacy-cli.ts audit-identity --prod
npx tsx scripts/privacy-cli.ts audit-identity --fix --prod   # expect only report-only kinds left
```

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
enforce them) plus Storage rules. `scripts/deploy.sh` runs the same command.

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

## 8. Smoke Tests

**Staging: automated.** `scripts/deploy.sh staging` ends with the post-deploy
smoke test from the operations repo (`machine-auth-operations/smoke/`, see its
README) — a ~4-minute Playwright run against the *deployed* staging apps. It
exists for what the emulator structurally cannot show: missing indexes, races
hidden by instant commits, IAM/secrets/allowed-origins, bundles built for the
wrong project, real mail delivery. It covers: sign-up and login by **mailed**
code (no imported-member welcome dialog, Auth uid == users doc id); a visit →
bill → **invoice mail with its PDF**; a deleted Auth record healing on login
(#633); a membership purchase, the **admin app** booking the payment and the
membership turning active; an admin e-mail change landing on the same uid; and
the **kiosk** in a plain browser — a virtual badge bought and then used to sign
in, with taps minted by the staging-only `mintTestTap`.

Because staging always deploys first, `scripts/deploy.sh staging prod` does not
touch production when the smoke test fails. `--no-smoke` skips it; run it alone
with `(cd ../machine-auth-operations && npm run smoke:staging)`. It needs
`gcloud auth login` + `gcloud auth application-default login` with staging
access, and refuses to run against the production project.

**Staging: the agent run.** The scripted suite only knows what it was told to
check. `/smoke-staging` in Claude Code sends an agent through
`machine-auth-operations/smoke/RUNBOOK.md`: it uses the apps step by step,
**looks at every screenshot**, reads the real mails and the invoice PDF as
images, and writes a report with a verdict. Its first run found an invoice PDF
without a recipient and a "Seite 1 / 1" on a two-page document — nothing a
scripted check would raise. Do it before a production deploy that changes
anything a member sees.

**Still by hand** (after a deploy that touches them):

1. **Google sign-in** — real Google blocks automation (its guard is covered in
   the emulator e2e).
2. **TWINT** — the automated visits end on the QR-bill method.
3. **A physical badge on the physical kiosk** — after a kiosk rebuild: tap,
   confirm the session, check out.
4. **Terminal check-in** — a MaCo terminal end to end.
5. **Production** — no automated run there: load both apps, sign in once,
   confirm the admin site demands the admin claim.

## 9. BigQuery statistics + data protection (ADR-0038 / ADR-0039)

One-time per project (staging first, then prod). See
[`data-protection.md`](data-protection.md) for the operating procedures.

**9a. BigQuery dataset + IAM:**

```bash
# Dataset, tables, dedup views (idempotent; re-run after schema changes):
npx tsx scripts/setup-bigquery.ts --project <project-id>

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
STATS_SUBJECT_SALT="$(gcloud secrets versions access latest \
  --secret=STATS_SUBJECT_SALT --project=<project-id>)" \
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
npx tsx scripts/deploy-gateway.ts --host maker1@maco-gateway.internal
```

This builds the gateway-service + pw_rpc protos via Bazel, stages a small payload (gateway sources + generated protos + vendored pigweed Python sources + a pinned `requirements.txt`), generates the `.env` from `config.jsonc` and Google Cloud Secret Manager (including `GATEWAY_ASCON_MASTER_KEY`), and deploys to the target host. On the host, the script ensures a Python 3.11 venv at `~/gateway/venv` and runs `pip install -r requirements.txt`.

Start the gateway after deploy:

```bash
ssh maker1@maco-gateway.internal 'cd ~/gateway && venv/bin/python -m maco_gateway.main'
```

The Pi needs `python3.11` + `python3.11-venv` installed once (Raspberry Pi OS Bookworm ships them).

See `scripts/deploy-gateway.ts --help` for additional options (e.g., `--remote-dir`, `--build-only`).
