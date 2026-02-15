#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Generate DeviceConfig from Firebase and upload to Particle Ledger.
 *
 * This script:
 *   1. Reads maco (terminal) data from Firebase Firestore
 *   2. Finds all machines controlled by this maco
 *   3. Generates a DeviceConfig protobuf (matching proto/particle/device_config.proto)
 *   4. Base64-encodes it and uploads to Particle Cloud ledger
 *
 * The device reads this as a CBOR string property keyed "device_config.proto.b64".
 *
 * Usage:
 *   npm run sync-config -- <particle-device-id> [--gateway-host <host>] [--gateway-port <port>] [--prod]
 *
 * Prerequisites:
 *   - Copy .env.template to .env and fill in your credentials
 *   - Run: npm install (in scripts/)
 *   - Run: cd functions && npm run build (compiles proto TS to JS)
 */

import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { DocumentReference } from "firebase-admin/firestore";
// Import from compiled JS output (tsx can't resolve named ESM exports from
// .ts files in the functions/ CJS package). Requires: cd functions && npm run build
import {
  DeviceConfig,
  HwRevision,
} from "../functions/lib/src/proto/particle/device_config.js";

// Load .env from scripts/ directory (works regardless of cwd)
// .env.local takes priority over .env (first match wins per key)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({
  path: [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

// -- Firebase data fetching --

interface MacoData {
  name: string;
  hwRevision?: number;
}

interface MachineData {
  name: string;
  requiredPermission?: DocumentReference[];
}

async function getFirestoreData(deviceId: string) {
  const admin = await import("firebase-admin");

  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!projectId) {
      throw new Error("FIREBASE_PROJECT_ID not set in .env file");
    }

    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    console.log(
      `Project: ${projectId}, Emulator: ${emulatorHost ?? "(production)"}`
    );

    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (emulatorHost) {
      // Emulator doesn't need credentials
      admin.initializeApp({ projectId });
    } else if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      console.log(`Using service account: ${serviceAccountPath}`);
      const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, "utf8")
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });
    } else {
      console.log("Using Application Default Credentials");
      admin.initializeApp({ projectId });
    }
  }

  const db = admin.firestore();

  console.log(`Reading maco/${deviceId}...`);
  const macoDoc = await db.collection("maco").doc(deviceId).get();
  if (!macoDoc.exists) {
    throw new Error(`Maco device ${deviceId} not found in Firestore`);
  }

  const macoData = macoDoc.data() as MacoData;
  console.log(`Found maco: ${macoData.name}`);

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

// -- Config generation --

function createDeviceConfig(
  macoData: MacoData,
  machines: Array<{ id: string; data: MachineData }>,
  gatewayHost: string,
  gatewayPort: number
): Uint8Array {
  const config = DeviceConfig.fromPartial({
    hwRevision: macoData.hwRevision ?? HwRevision.HW_REVISION_PROTOTYPE,
    machines: machines.map((machine) => ({
      id: { value: machine.id },
      label: machine.data.name,
      requiredPermissions: (machine.data.requiredPermission ?? []).map(
        (ref) => ({ value: ref.id })
      ),
      control: { control: { $case: "relay" as const, relay: {} } },
    })),
    gatewayHost,
    gatewayPort,
  });

  return DeviceConfig.encode(config).finish();
}

// -- Particle Cloud upload --

async function writeToParticleLedger(
  deviceId: string,
  ledgerName: string,
  protoB64: string
): Promise<void> {
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

  const Particle = (await import("particle-api-js")).default;
  const particle = new Particle();

  console.log(`Writing to ledger '${ledgerName}' on device ${deviceId}...`);
  const result = await particle.setLedgerInstance({
    product: productId,
    ledgerName,
    scopeValue: deviceId,
    instance: { data: { "device_config.proto.b64": protoB64 } },
    auth: particleToken,
  });

  console.log("Ledger updated successfully");
  console.log("Response:", JSON.stringify(result.body, null, 2));
}

// -- Main --

async function main() {
  const args = process.argv.slice(2);
  const prod = args.includes("--prod");
  const positionalArgs: string[] = [];
  let gatewayHost = "192.168.87.7";
  let gatewayPort = 5000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--prod") continue;
    if (args[i] === "--gateway-host" && i + 1 < args.length) {
      gatewayHost = args[++i];
    } else if (args[i] === "--gateway-port" && i + 1 < args.length) {
      gatewayPort = parseInt(args[++i], 10);
    } else if (args[i] === "--help" || args[i] === "-h") {
      positionalArgs.length = 0;
      break;
    } else {
      positionalArgs.push(args[i]);
    }
  }

  if (positionalArgs.length === 0) {
    console.log(`
Usage: npm run sync-config -- <particle-device-id> [options]

Options:
  --prod                  Read from production Firestore (default: local emulator)
  --gateway-host <host>   Gateway hostname/IP (default: ${gatewayHost})
  --gateway-port <port>   Gateway port (default: ${gatewayPort})

Prerequisites:
  Copy scripts/.env.template to scripts/.env and fill in credentials.
  Run: cd scripts && npm install
  Run: cd functions && npm run build
`);
    process.exit(0);
  }

  if (!prod) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.FIREBASE_PROJECT_ID = "oww-maschinenfreigabe";
    console.log("Using local emulator (pass --prod for production)\n");
  } else {
    // Clear emulator host in case .env.local set it
    delete process.env.FIRESTORE_EMULATOR_HOST;
    console.log("Using production Firestore\n");
  }

  const deviceId = positionalArgs[0];
  console.log(`=== Sync DeviceConfig for device ${deviceId} ===\n`);

  // 1. Fetch from Firebase
  const { maco, machines } = await getFirestoreData(deviceId);

  // 2. Create DeviceConfig protobuf
  console.log(`Gateway: ${gatewayHost}:${gatewayPort}`);
  const protoBytes = createDeviceConfig(maco, machines, gatewayHost, gatewayPort);
  const protoB64 = Buffer.from(protoBytes).toString("base64");
  console.log(
    `\nSerialized: ${protoBytes.length} bytes proto, ${protoB64.length} chars base64`
  );

  // 3. Upload to Particle Cloud
  await writeToParticleLedger(deviceId, "terminal-config", protoB64);

  console.log("\nDone! Config synced to Particle Cloud.");
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
