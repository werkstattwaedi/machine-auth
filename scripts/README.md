# Device Configuration Scripts

Scripts to manage DeviceConfig for machine authentication terminals (MaCo devices).

## Prerequisites

1. **Particle CLI** - Install and login:

   ```bash
   npm install -g particle-cli
   particle login
   ```

2. ## Setup

### 1. Create `.env` file

```bash
# Copy the template
cp .env.template .env

# Edit .env and fill in your values
nano .env  # or use your favorite editor
```

Required variables in `.env`:

- `PARTICLE_TOKEN`: Get with `particle token create`
- `PARTICLE_PRODUCT_ID`: Your Particle product ID or slug
- `FIREBASE_PROJECT_ID`: Your Firebase/GCP project ID
- `GOOGLE_APPLICATION_CREDENTIALS` (optional): Path to service account key

### 2. Firebase Authentication

Choose **one** of these methods:

**Option A: Service Account Key (Recommended for CI/CD)**

1. Download from [Firebase Console](https://console.firebase.google.com/) > Project Settings > Service Accounts
2. Add path to `.env`: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json`

**Option B: Application Default Credentials (Local Development)**

```bash
gcloud auth application-default login
gcloud config set project <your-firebase-project-id>
```

### 3. Verify Setup

```bash
npx tsx setup-firebase-auth.ts
```

This will check your authentication configuration and guide you through any missing steps.

3. **Install dependencies**:
   ```bash
   cd scripts
   npm install
   ```

## Scripts

### `sync-device-config.ts`

Syncs device configuration from Firebase to Particle Cloud ledger.

**What it does:**

1. Reads MaCo (terminal) data from Firebase Firestore
2. Finds all machines controlled by the MaCo device
3. Generates a DeviceConfig flatbuffer
4. Uploads it to Particle Cloud ledger (`terminal-config`)

## Usage

### Sync Device Configuration

```bash
npm run sync-config -- <device-id>
```

This will:

1. Read device (maco) and machine data from Firebase Firestore
2. Generate a DeviceConfig flatbuffer
3. Upload it to Particle Cloud ledger (`terminal-config`)

Example:

```bash
npm run sync-config -- 0a10aced202194944a042f04
```

The script uses configuration from `.env` file, so make sure it's properly configured first.

## Particle Ledger

The generated configuration is stored in the Particle Cloud ledger:

- **Ledger name:** `terminal-config`

## Troubleshooting

### "Unknown file extension .ts"

Make sure you're using `tsx` or `npm run` commands, not `node` directly.

### Firebase authentication errors

**Using Service Account:**

```bash
# Download service account key from Firebase Console
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
```

**Using Application Default Credentials:**

```bash
# Authenticate with gcloud
gcloud auth application-default login
gcloud config set project <PROJECT_ID>
```

### Particle CLI errors

```bash
# Re-login to Particle
particle login

# Verify access to device
particle list
```

### Module import errors

Make sure you've installed dependencies:

```bash
cd scripts
npm install
```

## Development

The scripts use:

- **TypeScript** with ES modules
- **tsx** for direct TypeScript execution
- **flatbuffers** for binary serialization
- **firebase-admin** for Firestore access
- **Particle CLI** for ledger operations

To modify the scripts:

1. Edit the `.ts` files
2. Run directly with `npx tsx <script>.ts`
3. No compilation step needed (tsx handles it)
