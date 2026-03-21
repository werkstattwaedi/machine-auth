# Configuration Guide

Complete guide to configuring all components of the machine authentication system for a new environment.

## Operations Repo Pattern

All deployment-specific configuration lives in a separate **operations repo**, not in this repository. This repo contains committed symlinks to `../machine-auth-operations/`.

**Setup:**

1. Create your operations repo from the [template](https://github.com/werkstattwaedi/machine-auth-operations-template)
2. Clone it as a sibling named `machine-auth-operations`:
   ```
   workspace/
   ├── machine-auth/                    # this repo
   │   └── operations -> ../machine-auth-operations/
   └── machine-auth-operations/         # your operations repo
   ```
3. Rename template files (drop `.template` suffix), fill in your values

The symlinks resolve automatically. Without the operations repo, builds fail with clear broken-symlink errors.

**What goes where:**

| Location | Contains |
|----------|----------|
| Operations repo `.env.local` | All dev/emulator variables (including test secrets) |
| Operations repo `.env.production` | Production parameters only (NO secrets) |
| Operations repo `.firebaserc` | Firebase project ID |
| Firebase Functions Secrets | Production secrets (`firebase functions:secrets:set`) |
| GCP Secret Manager | Gateway ASCON key |

See the [template repo README](https://github.com/werkstattwaedi/machine-auth-operations-template) for the complete list of variables.

---

## Table of Contents

- [Linux Serial Device Setup](#linux-serial-device-setup)
- [Firebase Project Setup](#firebase-project-setup)
- [Firebase Functions Configuration](#firebase-functions-configuration)
- [Web App Configuration](#web-app-configuration)
- [MaCo Gateway Configuration](#maco-gateway-configuration)
- [Factory Provisioning](#factory-provisioning)
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
3. Enter project name
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
5. Copy the Firebase configuration values into your operations repo `.env.production`

### 4. Service Account (for scripts and CI/CD)

1. Go to Project Settings > Service Accounts
2. Click **"Generate new private key"**
3. Download JSON file
4. Store securely - **NEVER commit to git**

---

## Firebase Functions Configuration

Firebase Functions use **secrets** (sensitive values stored in Secret Manager) and **parameters** (non-sensitive config in env files).

### Required Secrets

Set using Firebase CLI:

```bash
firebase login
firebase use <your-project-id>

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

Parameters are set in your operations repo env files. They are symlinked into the `functions/` directory automatically.

| Parameter | Description |
|-----------|-------------|
| `DIVERSIFICATION_SYSTEM_NAME` | System name for key diversification (e.g. `OwwMachineAuth`) |
| `PARTICLE_PRODUCT_ID` | Particle product ID or slug |

### Verify Configuration

```bash
# List all secrets
firebase functions:secrets:access
```

---

## Web App Configuration

The web app uses `VITE_*` environment variables from the operations repo. These are symlinked into `web/` as `.env.development` (dev) and `.env.production` (prod).

### Deployment Variables

Beyond Firebase config, the following deployment-specific variables are used:

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_CHECKOUT_DOMAIN` | Checkout subdomain | `checkout.example.com` |
| `VITE_FUNCTIONS_REGION` | Cloud Functions region | `us-central1` |
| `VITE_LOCALE` | Locale for formatting | `de-CH` |
| `VITE_CURRENCY` | Currency code | `CHF` |
| `VITE_ORGANIZATION_NAME` | Organization name | `My Workshop` |
| `VITE_IBAN` | Payment IBAN | `CH00 0000 0000 0000 0000 0` |
| `VITE_TWINT_URL` | TWINT payment URL (optional) | |
| `VITE_PAYMENT_RECIPIENT_*` | QR-bill recipient details | |

**Important:** The production API key should be **restricted** in Google Cloud Console:
- Application restrictions: HTTP referrers (set to your domain)
- API restrictions: Limit to Firebase APIs only

See [`docs/deployment-checklist.md`](deployment-checklist.md) for full deployment steps.

---

## MaCo Gateway Configuration

The MaCo gateway uses a secret stored in **Google Cloud Secret Manager** (separate from Firebase Functions secrets).

### Secrets

| GCP Secret | Description | How to Generate |
|------------|-------------|-----------------|
| `GATEWAY_ASCON_MASTER_KEY` | ASCON encryption key between terminal and gateway | `openssl rand -hex 16` |

This is distinct from the Firebase Functions secrets:
- `GATEWAY_ASCON_MASTER_KEY` — shared secret for ASCON-encrypted communication between the terminal firmware and the gateway
- `DIVERSIFICATION_MASTER_KEY` — master key for NTAG 424 key diversification (Firebase Functions secret)
- `TERMINAL_KEY` — key for SDM encryption/decryption on terminals (Firebase Functions secret)

### Set the Secret

```bash
gcloud config set project <your-project-id>

# Create the secret
echo -n "YOUR_HEX_KEY" | gcloud secrets create GATEWAY_ASCON_MASTER_KEY --data-file=-

# Or update an existing secret
echo -n "YOUR_HEX_KEY" | gcloud secrets versions add GATEWAY_ASCON_MASTER_KEY --data-file=-
```

### Local Development

For local development, the gateway reads `MASTER_KEY` from the operations repo `.env.local` (symlinked to `maco_gateway/.env.local`).

---

## Factory Provisioning

The factory console (`./pw factory-console`) provisions devices with two secrets. These are loaded automatically based on the mode:

### Secret Mapping

| Factory env var | Local source | GCP Secret Manager |
|----------------|-------------|-------------------|
| `FACTORY_GATEWAY_SECRET` | `.env.local` → `MASTER_KEY` | `GATEWAY_ASCON_MASTER_KEY` |
| `FACTORY_NTAG_KEY` | `.env.local` → `TERMINAL_KEY` | `TERMINAL_KEY` |

### Local Dev (default)

```bash
./pw factory-console
```

Reads secrets from operations repo `.env.local` (via symlinks).

### Production

```bash
./pw factory-console --prod
```

Fetches secrets from Google Cloud Secret Manager. Requires `gcloud` CLI installed and authenticated with access to the project.

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

The gateway sends requests to Firebase Functions. Configure the Particle webhook:

```json
{
  "event": "terminalRequest",
  "url": "https://<region>-<project-id>.cloudfunctions.net/api",
  "requestType": "POST",
  "noDefaults": true,
  "rejectUnauthorized": true,
  "headers": {
    "Authorization": "Bearer <YOUR_PARTICLE_WEBHOOK_API_KEY>"
  },
  "responseTemplate": "{{PARTICLE_PUBLISHED_AT}}"
}
```

**Deploy webhook:**

```bash
particle webhook create <path-to-webhook.json>
```

### 4. Add Devices to Product

1. Flash firmware to Photon 2 device
2. Claim device to your Particle account
3. Add device to your product

---

## Firestore Security Rules

**Location:** `firestore/firestore.rules`

Security rules use Firebase Auth **custom claims** for role-based access. The `syncCustomClaims` Cloud Function trigger syncs the `roles[]` field from user documents to Auth custom claims, so rules can check `request.auth.token.admin == true`.

**Deploy rules:**

```bash
firebase deploy --only firestore:rules
```

**After deploying:** Existing admin users need their custom claims set. Re-save their user doc to trigger `syncCustomClaims`, or set claims manually via Firebase Admin SDK.

---

## Environment Checklist

Use this checklist when setting up a new environment:

### Operations Repo

- [ ] Operations repo created from [template](https://github.com/werkstattwaedi/machine-auth-operations-template)
- [ ] Cloned as sibling: `machine-auth-operations/`
- [ ] `.env.local` configured (rename from template)
- [ ] `.env.production` configured (rename from template)
- [ ] `.firebaserc` configured (rename from template)

### Firebase

- [ ] Firebase project created
- [ ] Authentication enabled (Email link sign-in)
- [ ] Firestore database created
- [ ] Hosting enabled
- [ ] Service account key downloaded (for scripts/CI)

### Firebase Functions

- [ ] All secrets set via `firebase functions:secrets:set`
- [ ] Functions deployed: `firebase deploy --only functions`

### Web App

- [ ] Production API key restricted in Google Cloud Console
- [ ] Web app built and deployed: `firebase deploy --only hosting`
- [ ] First admin user created with `roles: ['admin']`
- [ ] Custom claims set for admin user (via `syncCustomClaims` trigger)

### MaCo Gateway

- [ ] `GATEWAY_ASCON_MASTER_KEY` set in Google Cloud Secret Manager

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

---

## Troubleshooting

### "Secret not found" error

Ensure secrets are set:
```bash
firebase functions:secrets:access
```

### "Missing Firebase configuration"

Check that the operations repo is cloned as a sibling and symlinks resolve:
```bash
ls -la operations/  # Should not be a broken symlink
cat .firebaserc     # Should show your project config
```

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

- [Operations Template](https://github.com/werkstattwaedi/machine-auth-operations-template) - Setup guide for new deployments
- [Deployment Checklist](deployment-checklist.md)
- [Compilation Guide](compile.md)
- [CLAUDE.md](../CLAUDE.md) - Development patterns and architecture
