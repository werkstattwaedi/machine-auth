# Deployment Checklist

Steps to deploy the full system to production.

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
into the staging project — see ADR-0034). After rotating any secret in
prod, re-copy it:

```bash
gcloud secrets versions access latest --secret=<NAME> --project=oww-maco \
  | firebase functions:secrets:set <NAME> --project oww-maco-staging --data-file=-
```

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
firebase functions:secrets:set PARTICLE_TOKEN
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set TERMINAL_KEY
```

Verify: `firebase functions:secrets:access GATEWAY_API_KEY`

**Google Cloud Secret Manager (gateway):**

```bash
gcloud config set project <your-project-id>
echo -n "$(openssl rand -hex 16)" | gcloud secrets create GATEWAY_ASCON_MASTER_KEY --data-file=-
```

See [`config.md`](config.md#maco-gateway-configuration) for details.

## 2. Environment Config

String parameters (`DIVERSIFICATION_SYSTEM_NAME`, `PARTICLE_PRODUCT_ID`,
`LOGIN_*`, …) are `defineString` params read from `functions/.env.<projectId>`
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

## 4. Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

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

1. **Public checkout**: Visit checkout site with `?picc=...&cmac=...` tag URL
2. **Login**: Request 6-digit code on `/login`, redeem it (or click the magic link in the Resend email) to complete sign-in
3. **Dashboard**: Verify user doc loads from Firestore
4. **Admin site**: Visit admin site, verify it requires admin custom claim
5. **Functions**: Check a terminal checkin works end-to-end

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
