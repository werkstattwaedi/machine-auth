# Deployment Checklist

Steps to deploy the full system to production.

## Prerequisites

- Firebase CLI authenticated: `firebase login`
- Correct project selected: `firebase use oww-maco`

## 1. Secrets

Set all required secrets:

**Firebase Functions secrets:**

```bash
firebase functions:secrets:set DIVERSIFICATION_MASTER_KEY
firebase functions:secrets:set PARTICLE_WEBHOOK_API_KEY
firebase functions:secrets:set GATEWAY_API_KEY
firebase functions:secrets:set TERMINAL_KEY
firebase functions:secrets:set PARTICLE_TOKEN
```

Verify: `firebase functions:secrets:access GATEWAY_API_KEY`

**Google Cloud Secret Manager (gateway):**

```bash
gcloud config set project <your-project-id>
echo -n "$(openssl rand -hex 16)" | gcloud secrets create GATEWAY_ASCON_MASTER_KEY --data-file=-
```

See [`config.md`](config.md#maco-gateway-configuration) for details.

## 2. Environment Config

Set string parameters:

```bash
firebase functions:config:set DIVERSIFICATION_SYSTEM_NAME="oww"
firebase functions:config:set PARTICLE_PRODUCT_ID="<product-id>"
```

## 3. Deploy Functions

```bash
cd functions
npm run build
firebase deploy --only functions
```

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
npx tsx scripts/deploy-gateway.ts --host pi@rpi.local
```

This builds the gateway tarball, generates the `.env` from `config.jsonc` and Google Cloud Secret Manager (including `GATEWAY_ASCON_MASTER_KEY`), and deploys to the target host.

See `scripts/deploy-gateway.ts --help` for additional options (e.g., `--remote-dir`, `--build-only`).
