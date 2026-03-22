# Scripts

CLI tools for device provisioning and configuration. User/token management has moved to the web UI.

## Scripts

| Script | Purpose | Requires |
|--------|---------|----------|
| `setup-device.ts` | Provision a Particle P2 device (product, Wi-Fi) | USB-connected device |
| `sync-device-config.ts` | Sync machine config from Firebase → Particle ledger | Firebase + Particle creds |
| `seed-emulator.ts` | Populate Firebase emulator with test data | Running emulators |

## Setup

Most environment variables are generated automatically from the operations repo config:

```bash
npm run generate-env   # from project root — generates scripts/.env
```

For scripts that need credentials (`sync-device-config.ts`, `setup-device.ts`), create `scripts/.env.local` with your personal tokens:

```bash
cd scripts
cp .env.template .env.local   # Fill in credentials
```

### Environment Variables

`scripts/.env` (auto-generated from operations config):
- `FIREBASE_PROJECT_ID`, `PARTICLE_PRODUCT_ID`, and all `VITE_*` vars

`scripts/.env.local` (manually maintained, gitignored):
- `PARTICLE_TOKEN`: Get with `particle token create`
- `PARTICLE_PRODUCT_NAME`: Product name (for device setup)
- `WIFI_SSID` / `WIFI_PASS`: Wi-Fi credentials (for device setup)
- `GOOGLE_APPLICATION_CREDENTIALS` (optional): Service account key path

### Firebase Authentication

**Option A: Service Account Key**
Download from Firebase Console > Project Settings > Service Accounts. Set path in `.env`.

**Option B: Application Default Credentials (local dev)**
```bash
gcloud auth application-default login
gcloud config set project oww-maco
```

## Usage

```bash
# Provision a new Particle device (USB, listening mode)
npm run setup-device

# Sync device config to Particle Cloud
npm run sync-config -- <device-id>

# Seed emulator (from root, emulators running)
npm run seed
```

## What moved to the web UI

- **User management** (listing, editing) → web admin panel
- **Token management** (adding, deactivating) → web admin panel
