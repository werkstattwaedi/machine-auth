#!/usr/bin/env ts-node
/**
 * Generate DeviceConfig from Firebase and upload to Particle Ledger
 * 
 * This script:
 * 1. Reads maco (terminal) data from Firebase
 * 2. Finds all machines con  // Get Particle configuration from environment
  const particleToken = process.env.PARTICLE_TOKEN;
  if (!particleToken) {
    throw new Error('PARTICLE_TOKEN not set in .env file. Get with: particle token create');
  }
  
  const productId = process.env.PARTICLE_PRODUCT_ID;
  if (!productId) {
    throw new Error('PARTICLE_PRODUCT_ID not set in .env file');
  } this maco
 * 3. Generates a DeviceConfig flatbuffer
 * 4. Uploads it to Particle Cloud ledger
 * 
 * Usage:
 *   ts-node sync-device-config.ts <particle-device-id>
 * 
 * Example:
 *   ts-node sync-device-config.ts 0a10aced202194944a042f04
 * 
 * Prerequisites:
 *   - Copy .env.template to .env and fill in your credentials
 *   - Run: npm install
 */

import * as flatbuffers from "flatbuffers";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";

// Load environment variables from .env file
loadEnv();

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import FlatBuffers types from compiled functions
import { DeviceConfigT } from "../functions/lib/fbs/device-config.js";
import { MachineT } from "../functions/lib/fbs/machine.js";
import { HwRevision } from "../functions/lib/fbs/hw-revision.js";
import { MachineControl } from "../functions/lib/fbs/machine-control.js";
import { MachineControlRelaisT } from "../functions/lib/fbs/machine-control-relais.js";
import { DocumentReference } from "firebase-admin/firestore";

interface MacoData {
  name: string;
  hwRevision?: number;
}

interface MachineData {
  name: string;
  requiredPermission?: DocumentReference[];
  control?: {
    type?: string;
  };
}

/**
 * Execute a shell command and return the output
 */
function execCommand(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8" }).trim();
  } catch (error: any) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    throw error;
  }
}

/**
 * Use Firebase Admin SDK to fetch data from Firestore
 */
async function getFirestoreDataWithSDK(deviceId: string): Promise<{
  maco: MacoData;
  machines: Array<{ id: string; data: MachineData }>;
}> {
  // Import Firebase Admin SDK
  const admin = await import("firebase-admin");

  // Initialize if not already initialized
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!projectId) {
      throw new Error("FIREBASE_PROJECT_ID not set in .env file");
    }

    // Check for service account credentials
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      console.log(`Using service account: ${serviceAccountPath}`);
      const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, "utf8")
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId,
      });
    } else {
      // Try using Application Default Credentials (works if you're logged in with gcloud)
      console.log(
        "No service account found, attempting to use Application Default Credentials..."
      );
      console.log(
        "If this fails, set GOOGLE_APPLICATION_CREDENTIALS in .env file."
      );
      admin.initializeApp({
        projectId: projectId,
      });
    }
  }

  const db = admin.firestore();

  // Get maco data
  console.log(`Reading maco/${deviceId}...`);
  const macoDoc = await db.collection("maco").doc(deviceId).get();

  if (!macoDoc.exists) {
    throw new Error(`Maco device ${deviceId} not found in Firestore`);
  }

  const macoData = macoDoc.data() as MacoData;
  console.log(`Found maco: ${macoData.name}`);

  // Query machines that reference this maco
  console.log(`Querying machines controlled by maco/${deviceId}...`);
  const machinesSnapshot = await db
    .collection("machine")
    .where("maco", "==", macoDoc.ref)
    .get();

  const machines = machinesSnapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as MachineData,
  }));

  console.log(`Found ${machines.length} machine(s)`);

  return { maco: macoData, machines };
}

/**
 * Create DeviceConfig from Firebase data
 */
function createDeviceConfig(
  macoData: MacoData,
  machines: Array<{ id: string; data: MachineData }>
): DeviceConfigT {
  // Determine hardware revision
  const hwRevision = macoData.hwRevision || HwRevision.Prototype;

  // Create machine objects
  const machineObjects = machines.map((machine) => {
    const permissions = (machine.data.requiredPermission || []).map(
      (permission) => permission.id
    );

    // Determine control type (currently only relais is supported)
    const controlType = MachineControl.relais;
    const control = new MachineControlRelaisT();

    return new MachineT(
      machine.id,
      machine.data.name,
      permissions,
      controlType,
      control
    );
  });

  return new DeviceConfigT(hwRevision, machineObjects);
}

/**
 * Serialize DeviceConfig to base64
 */
function serializeToBase64(config: DeviceConfigT): string {
  const builder = new flatbuffers.Builder(1024);
  const offset = config.pack(builder);
  builder.finish(offset);

  const bytes = builder.asUint8Array();
  return Buffer.from(bytes).toString("base64");
}

/**
 * Write data to Particle ledger using particle-api-js
 */
async function writeToParticleLedger(
  deviceId: string,
  ledgerName: string,
  base64Data: string
): Promise<void> {
  console.log(`\nWriting to Particle ledger...`);
  console.log(`Device: ${deviceId}`);
  console.log(`Ledger: ${ledgerName}`);

  // Get Particle configuration from environment
  const particleToken = process.env.PARTICLE_TOKEN;
  if (!particleToken) {
    throw new Error(
      "PARTICLE_TOKEN not set in .env file. Get a token with: particle token create"
    );
  }

  const productId = process.env.PARTICLE_PRODUCT_ID;
  if (!productId) {
    throw new Error("PARTICLE_PRODUCT_ID not set in .env file");
  }

  try {
    // Import Particle API
    const Particle = (await import("particle-api-js")).default;
    const particle = new Particle();

    // Set the ledger instance data
    console.log(`Setting ledger instance for device ${deviceId}...`);
    const result = await particle.setLedgerInstance({
      product: productId,
      ledgerName: ledgerName,
      scopeValue: deviceId,
      instance: { data: { fbs: base64Data } },
      auth: particleToken,
    });

    console.log(`✓ Successfully wrote to ledger`);
    console.log("Response:", JSON.stringify(result.body, null, 2));
  } catch (error: any) {
    console.error(`✗ Failed to write to ledger: ${error.message}`);
    if (error.body) {
      console.error("Error details:", JSON.stringify(error.body, null, 2));
    }
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Usage: npx tsx sync-device-config.ts <particle-device-id>

Example:
  npx tsx sync-device-config.ts 0a10aced202194944a042f04
  
Or using npm script:
  npm run sync-config -- 0a10aced202194944a042f04

This script will:
1. Read maco and machine data from Firebase Firestore (using Admin SDK)
2. Generate a DeviceConfig flatbuffer
3. Upload it to Particle Cloud ledger (terminal-config)

Prerequisites:
1. Copy .env.template to .env and fill in your credentials:
   - PARTICLE_TOKEN: Get with 'particle token create'
   - PARTICLE_PRODUCT_ID: Your Particle product ID or slug
   - FIREBASE_PROJECT_ID: Your Firebase project ID
   - GOOGLE_APPLICATION_CREDENTIALS (optional): Path to service account key

2. Authenticate with Firebase (one of the following):
   
   Option A: Service Account Key (Recommended for CI/CD)
     - Download from Firebase Console > Project Settings > Service Accounts
     - Set path in .env: GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
   
   Option B: Application Default Credentials (for local development)
     - Run: gcloud auth application-default login
     - Run: gcloud config set project <your-firebase-project-id>

View ledger in Particle Console at:
https://console.particle.io/<your-product>/ledger/terminal-config
`);
    process.exit(0);
  }

  const deviceId = args[0];

  console.log(`=== Sync DeviceConfig for device ${deviceId} ===\n`);

  try {
    // Get data from Firebase using Admin SDK
    const { maco, machines } = await getFirestoreDataWithSDK(deviceId);

    // Create DeviceConfig
    console.log(`\nGenerating DeviceConfig...`);
    const deviceConfig = createDeviceConfig(maco, machines);

    console.log("\nDeviceConfig JSON:");
    console.log(JSON.stringify(deviceConfig, null, 2));

    // Serialize to base64
    const base64 = serializeToBase64(deviceConfig);
    console.log(`\nSerialized (base64):`);
    console.log(base64);
    console.log(`Binary size: ${Buffer.from(base64, "base64").length} bytes`);

    // Write to Particle ledger
    await writeToParticleLedger(deviceId, "terminal-config", base64);

    console.log(`\n✓ Success! DeviceConfig has been synced to Particle Cloud`);
    console.log(`\nView in console:`);
    console.log(
      `https://console.particle.io/maschinenfreigabe-33764/ledger/terminal-config`
    );
  } catch (error: any) {
    console.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});

export { createDeviceConfig, serializeToBase64 };
