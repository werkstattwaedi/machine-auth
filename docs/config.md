# Configuration Guide

Complete guide to configuring all components of the machine authentication system for a new environment.

## Table of Contents

- [Linux Serial Device Setup](#linux-serial-device-setup)
- [Firebase Project Setup](#firebase-project-setup)
- [Firebase Functions Configuration](#firebase-functions-configuration)
- [Web App Configuration](#web-app-configuration)
- [Scripts Configuration](#scripts-configuration)
- [Particle Cloud Setup](#particle-cloud-setup)
- [Firestore Security Rules](#firestore-security-rules)
- [Environment Checklist](#environment-checklist)

---

## Linux Serial Device Setup

For reliable console connections on Linux, install a udev rule that creates stable device symlinks.

**Problem:** Particle devices appear as `/dev/ttyACM0`, `/dev/ttyACM1`, etc., and the number changes based on plug-in order.

**Solution:** A udev rule creates `/dev/particle_XXXX` where XXXX is the last 4 hex digits of the device serial number.

### Installation

Create `/etc/udev/rules.d/99-particle.rules`:

```
# Particle devices - create symlink with last 4 digits of serial
# e.g., serial 0a10aced202194944a042f04 -> /dev/particle_2f04
SUBSYSTEM=="tty", ATTRS{idVendor}=="2b04", PROGRAM="/bin/sh -c 'echo $attr{serial} | tail -c 5'", SYMLINK+="particle_%c", MODE="0666"
```

Then reload udev rules:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

### Finding Your Device Serial

With device plugged in:

```bash
udevadm info -a /dev/ttyACM0 | grep serial
# Look for: ATTRS{serial}=="0a10aced202194944a042f04"
# Last 4 digits: 2f04 -> /dev/particle_2f04
```

### Verification

After setting up the rule and plugging in your device:

```bash
ls -la /dev/particle_*
# Should show: /dev/particle_2f04 -> ttyACM0
```

The `./pw console` command automatically detects `/dev/particle_*` devices.

---

## Firebase Project Setup

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"**
3. Enter project name: `oww-maschinenfreigabe` (or your preferred name)
4. Enable Google Analytics (optional)
5. Create project

### 2. Enable Required Services

In Firebase Console:

1. **Authentication**
   - Go to Authentication > Sign-in method
   - Enable **Google** provider
   - Enable **Email/Password** provider
   - Add authorized domain for production (e.g., `your-domain.com`)

2. **Firestore Database**
   - Go to Firestore Database
   - Create database in **production mode**
   - Choose a location (e.g., `us-central`)

3. **Hosting**
   - Go to Hosting
   - Click "Get started" and follow wizard

4. **Functions**
   - Will be automatically enabled when you deploy

### 3. Get Firebase Configuration

1. Go to Project Settings (gear icon) > General
2. Scroll to "Your apps" section
3. Click "Add app" > Web (</>) icon
4. Register app with nickname: `admin`
5. Copy the Firebase configuration object (needed for admin UI)

### 4. Service Account (for scripts and CI/CD)

1. Go to Project Settings > Service Accounts
2. Click **"Generate new private key"**
3. Download JSON file
4. Store securely - **NEVER commit to git**
5. Note the file path for later configuration

---

## Firebase Functions Configuration

Firebase Functions use **secrets** (sensitive values) and **parameters** (non-sensitive config).

### Required Secrets

Set using Firebase CLI or Console:

```bash
# Login to Firebase
firebase login

# Set project
firebase use oww-maschinenfreigabe

# Set secrets (will prompt for values)
firebase functions:secrets:set DIVERSIFICATION_MASTER_KEY
firebase functions:secrets:set PARTICLE_WEBHOOK_API_KEY
firebase functions:secrets:set GATEWAY_API_KEY
firebase functions:secrets:set TERMINAL_KEY
firebase functions:secrets:set PARTICLE_TOKEN
```

**Secret Descriptions:**

| Secret | Description | How to Generate |
|--------|-------------|-----------------|
| `DIVERSIFICATION_MASTER_KEY` | 32-character hex key for tag personalization | `openssl rand -hex 16` |
| `PARTICLE_WEBHOOK_API_KEY` | API key for Particle webhook authentication | `openssl rand -hex 32` |
| `GATEWAY_API_KEY` | API key for MaCo gateway authentication | `openssl rand -hex 32` |
| `TERMINAL_KEY` | Key for SDM encryption/decryption on terminals | `openssl rand -hex 16` |
| `PARTICLE_TOKEN` | Particle Cloud access token | `particle token create` (see [Particle Setup](#particle-cloud-setup)) |

### Required Parameters

Set using `.env` files in `functions/` directory:

**Development** (`functions/.env.local`):
```bash
DIVERSIFICATION_SYSTEM_NAME=OwwMachineAuth
```

**Production** (`functions/.env.oww-maschinenfreigabe`):
```bash
DIVERSIFICATION_SYSTEM_NAME=OwwMachineAuth
```

Or set via Firebase CLI:
```bash
firebase functions:config:set diversification.system_name="OwwMachineAuth"
```

### New: Admin API Parameters

For the admin API (device import feature), also set:

```bash
# Set as parameter (non-sensitive)
firebase functions:config:set particle.product_id="YOUR_PRODUCT_ID_OR_SLUG"
```

Or add to your `.env` files:
```bash
PARTICLE_PRODUCT_ID=your-product-id-or-slug
```

**Note:** `PARTICLE_TOKEN` is already set as a secret (see above).

### Verify Configuration

```bash
# List all secrets
firebase functions:secrets:access

# List all config
firebase functions:config:get
```

---

## Web App Configuration

The web app (`web/`) uses Vite environment files for Firebase configuration. Emulator connections are automatic in dev mode.

### Development Environment

**File:** `web/.env.development` (checked in, safe values)

Emulator connections are automatic — `web/src/lib/firebase.ts` detects `import.meta.env.DEV` and connects to local emulators.

### Production Environment

**File:** `web/.env.production`

```bash
VITE_FIREBASE_API_KEY=YOUR_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN=oww-maschinenfreigabe.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=oww-maschinenfreigabe
VITE_FIREBASE_STORAGE_BUCKET=oww-maschinenfreigabe.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=YOUR_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID=YOUR_APP_ID
```

**How to get these values:**

1. Firebase Console > Project Settings > General
2. Scroll to "Your apps" > Select your web app
3. Click "Config" to see the configuration object
4. Copy values to `web/.env.production`

**Important:** The production API key should be **restricted** in Google Cloud Console:
- Application restrictions: HTTP referrers (set to your domain)
- API restrictions: Limit to Firebase APIs only

See [`docs/deployment-checklist.md`](deployment-checklist.md) for full deployment steps.

---

## Scripts Configuration

Scripts for device config synchronization use their own configuration.

### Setup

**File:** `scripts/.env`

```bash
# Copy template
cd scripts
cp .env.template .env
```

**Edit `scripts/.env`:**

```bash
# Your Particle product ID or slug (from Particle Console)
PARTICLE_PRODUCT_ID="your-product-id-or-slug"

# Particle access token (create with: particle token create)
PARTICLE_TOKEN="your-particle-token-here"

# Firebase project ID
FIREBASE_PROJECT_ID="oww-maschinenfreigabe"

# Path to Firebase service account key (OPTIONAL)
# If not set, uses Application Default Credentials
GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
```

### Firebase Authentication for Scripts

Choose **one** method:

**Option A: Service Account Key (Recommended)**

1. Download service account key from Firebase Console (see [Firebase Setup](#4-service-account-for-scripts-and-cicd))
2. Set path in `.env`: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`

**Option B: Application Default Credentials (Local Dev)**

```bash
gcloud auth application-default login
gcloud config set project oww-maschinenfreigabe
```

Then **omit** `GOOGLE_APPLICATION_CREDENTIALS` from `.env`.

### Install Dependencies

```bash
cd scripts
npm install
```

### Verify Configuration

```bash
cd scripts
npm run sync-config -- --help
```

See [`scripts/README.md`](../scripts/README.md) for detailed usage.

---

## Particle Cloud Setup

The system integrates with Particle IoT for device management.

### 1. Create Particle Product

1. Go to [Particle Console](https://console.particle.io/)
2. Create a new **Product**
3. Note the **Product ID** or **Product Slug** (needed for configuration)

### 2. Generate Access Token

```bash
# Install Particle CLI
npm install -g particle-cli

# Login
particle login

# Create an access token
particle token create
```

**Important:** This token has full access to your Particle account. Store it securely as a Firebase secret (see [Functions Configuration](#required-secrets)).

### 3. Configure Webhook

The firmware sends requests to Firebase Functions via Particle webhooks.

**Create webhook** (`particle/terminalRequest_webhook.json`):

```json
{
  "event": "terminalRequest",
  "url": "https://us-central1-oww-maschinenfreigabe.cloudfunctions.net/api",
  "requestType": "POST",
  "noDefaults": true,
  "rejectUnauthorized": true,
  "headers": {
    "Authorization": "Bearer YOUR_PARTICLE_WEBHOOK_API_KEY"
  },
  "responseTemplate": "{{PARTICLE_PUBLISHED_AT}}"
}
```

**Deploy webhook:**

```bash
particle webhook create particle/terminalRequest_webhook.json
```

**Note:** Replace `YOUR_PARTICLE_WEBHOOK_API_KEY` with the value you set in [Functions Secrets](#required-secrets).

### 4. Add Devices to Product

1. Flash firmware to Photon 2 device
2. Claim device to your Particle account
3. Add device to your product

---

## Firestore Security Rules

**Location:** `firestore/firestore.rules`

Security rules use Firebase Auth **custom claims** for role-based access. The `syncCustomClaims` Cloud Function trigger syncs the `roles[]` field from user documents to Auth custom claims, so rules can check `request.auth.token.admin == true`.

**Key behaviors:**
- All authenticated users can read most collections
- Only admins can write to `permission`, `tokens`, `machine`, `maco`, `sessions`
- Users can update their own user doc (doc ID = Auth UID) but cannot change `roles` or `permissions`
- User document creation requires authentication and the doc ID must match the Auth UID

**Deploy rules:**

```bash
firebase deploy --only firestore:rules
```

**After deploying:** Existing admin users need their custom claims set. Re-save their user doc to trigger `syncCustomClaims`, or set claims manually via Firebase Admin SDK.

---

## Environment Checklist

Use this checklist when setting up a new environment:

### Firebase

- [ ] Firebase project created
- [ ] Authentication enabled (Email link sign-in)
- [ ] Firestore database created
- [ ] Hosting enabled
- [ ] Service account key downloaded (for scripts/CI)
- [ ] Firebase configuration copied to `web/.env.production`

### Firebase Functions

- [ ] `DIVERSIFICATION_MASTER_KEY` secret set
- [ ] `PARTICLE_WEBHOOK_API_KEY` secret set
- [ ] `GATEWAY_API_KEY` secret set
- [ ] `TERMINAL_KEY` secret set
- [ ] `PARTICLE_TOKEN` secret set
- [ ] `DIVERSIFICATION_SYSTEM_NAME` parameter set
- [ ] `PARTICLE_PRODUCT_ID` parameter set
- [ ] Functions deployed: `firebase deploy --only functions`

### Web App

- [ ] `web/.env.production` configured with Firebase credentials
- [ ] Production API key restricted in Google Cloud Console
- [ ] Web app built and deployed: `firebase deploy --only hosting`
- [ ] First admin user created with `roles: ['admin']`
- [ ] Custom claims set for admin user (via `syncCustomClaims` trigger)

### Scripts

- [ ] `scripts/.env` file created from template
- [ ] All variables in `.env` filled in
- [ ] Firebase authentication configured (service account or ADC)
- [ ] Dependencies installed: `npm install`
- [ ] Test sync: `npm run sync-config -- <device-id>`

### Particle Cloud

- [ ] Product created
- [ ] Access token generated
- [ ] Webhook created and deployed
- [ ] Test device added to product

### Security

- [ ] Firestore security rules deployed (custom claims-based)
- [ ] Service account keys stored securely (not in git)
- [ ] Firebase secrets set (not in `.env` files)
- [ ] Production API key restricted

### Optional

- [ ] Error tracking configured (Sentry, etc.)
- [ ] Analytics enabled
- [ ] Monitoring/alerting set up
- [ ] Backup strategy documented

---

## Quick Start: New Environment Setup

**1. Firebase Project**
```bash
# Create project in Firebase Console
# Enable: Auth, Firestore, Hosting

# Get Firebase config for admin UI
# (Project Settings > General > Your apps)
```

**2. Set Secrets**
```bash
firebase login
firebase use <your-project-id>

# Generate and set secrets
firebase functions:secrets:set DIVERSIFICATION_MASTER_KEY  # openssl rand -hex 16
firebase functions:secrets:set PARTICLE_WEBHOOK_API_KEY    # openssl rand -hex 32
firebase functions:secrets:set PARTICLE_TOKEN              # particle token create
```

**3. Configure Functions**
```bash
# Set parameters
firebase functions:config:set \
  diversification.system_name="OwwMachineAuth" \
  particle.product_id="<your-product-id>"

# Or use .env files in functions/ directory
```

**4. Configure Web App**
```bash
# Edit web/.env.production with Firebase config
cd web
npm install
npm run build
```

**5. Configure Scripts**
```bash
cd scripts
cp .env.template .env
# Edit .env with your values
npm install
```

**6. Deploy**
```bash
# From project root
firebase deploy
```

**7. Create First Admin**
```bash
# Manually create first admin user in Firestore
# Collection: users
# Document: auto-generated ID
# Fields:
#   email: "admin@example.com"
#   displayName: "Admin User"
#   roles: ["admin"]
#   permissions: []
#   created: serverTimestamp()
```

---

## Troubleshooting

### "Secret not found" error

Ensure secrets are set:
```bash
firebase functions:secrets:access
```

### "Missing Firebase configuration"

Check `.env` files in `functions/` directory and verify parameter values.

### "Permission denied" in Firestore

Check Firestore security rules. In development, you can temporarily use test mode rules (but **never in production**).

### Scripts can't access Firebase

Verify authentication:
```bash
# Using service account
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json

# Or using gcloud
gcloud auth application-default login
```

### Admin UI can't connect to functions

Check CORS configuration in `functions/src/admin-api.ts` - should have `cors: true`.

For emulators, ensure you're using the correct URL (127.0.0.1, not localhost).

---

## Related Documentation

- [Admin UI Deployment Checklist](requirements/admin-ui-deployment.md)
- [Scripts README](../scripts/README.md)
- [Compilation Guide](compile.md)
- [CLAUDE.md](../CLAUDE.md) - Development patterns and architecture

---

**Last Updated:** 2025-10-12
**Maintainer:** Project team
