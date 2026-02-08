# Deployment Checklist

Steps to deploy the full system to production.

## Prerequisites

- Firebase CLI authenticated: `firebase login`
- Correct project selected: `firebase use oww-maschinenfreigabe`

## 1. Secrets

Set all required secrets in Firebase:

```bash
firebase functions:secrets:set DIVERSIFICATION_MASTER_KEY
firebase functions:secrets:set PARTICLE_WEBHOOK_API_KEY
firebase functions:secrets:set GATEWAY_API_KEY
firebase functions:secrets:set TERMINAL_KEY
firebase functions:secrets:set PARTICLE_TOKEN
```

Verify: `firebase functions:secrets:access GATEWAY_API_KEY`

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

## 6. Deploy Web App

```bash
cd web
npm install
npm run build
firebase deploy --only hosting
```

Verify: Visit `https://oww-maschinenfreigabe.web.app/`

## 7. Full Deploy (all at once)

```bash
firebase deploy
```

## 8. Smoke Tests

1. **Public checkout**: Visit `/checkout?picc=...&cmac=...` with a valid tag URL
2. **Login**: Send email link, complete sign-in
3. **Dashboard**: Verify user doc loads from Firestore
4. **Admin access**: Verify admin-only pages are restricted to users with admin custom claim
5. **Functions**: Check a terminal checkin works end-to-end

## Gateway Deployment

The gateway runs separately (not on Firebase). See `maco_gateway/` for deployment.

Required args:
- `--master-key`: ASCON master key (same as `DIVERSIFICATION_MASTER_KEY`)
- `--firebase-url`: Production URL (`https://us-central1-oww-maschinenfreigabe.cloudfunctions.net/api`)
- `--gateway-api-key`: Must match `GATEWAY_API_KEY` secret in Firebase
