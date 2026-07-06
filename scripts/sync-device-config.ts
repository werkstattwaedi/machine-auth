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
 *   npm run sync-config -- <particle-device-id> [--prod]
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

// Load .env from scripts/ directory (works regardless of cwd).
// dotenv uses first-match-wins, so the file we list FIRST overrides the second.
// In --prod we want scripts/.env (operations-generated) to win; otherwise
// scripts/.env.local (operator's local-dev edits) wins.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD_MODE = process.argv.slice(2).includes("--prod");
loadEnv({
  path: PROD_MODE
    ? [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")]
    : [path.join(__dirname, ".env.local"), path.join(__dirname, ".env")],
});

// -- Firebase data fetching --

interface MacoData {
  name: string;
  hwRevision?: number;
}

// Machine control config, mirrors the `MachineControl` proto oneof and the
// `MachineEntity.control` Firestore shape (functions firestore_entities.ts).
type MachineControlDoc =
  | { type?: "relay" }
  | {
      type: "xtool_p2s";
      host: string;
      port?: number;
      idleTimeoutSec?: number;
      idleWarningSec?: number;
      pollIntervalSec?: number;
    };

interface MachineData {
  name: string;
  requiredPermission?: DocumentReference[];
  control?: MachineControlDoc;
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

// Map the Firestore `control` doc to the proto MachineControl oneof.
// Zero-values are left for the firmware to resolve to its documented defaults.
function buildControl(control: MachineControlDoc | undefined) {
  if (control?.type === "xtool_p2s") {
    return {
      control: {
        $case: "xtoolP2s" as const,
        xtoolP2s: {
          host: control.host ?? "",
          port: control.port ?? 0,
          idleTimeoutSec: control.idleTimeoutSec ?? 0,
          idleWarningSec: control.idleWarningSec ?? 0,
          pollIntervalSec: control.pollIntervalSec ?? 0,
        },
      },
    };
  }
  return { control: { $case: "relay" as const, relay: {} } };
}

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
      control: buildControl(machine.data.control),
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
  // Reuse the logged-in `particle login` session (auth file under ~/.particle).
  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  const particleAuthPath = homeDir
    ? path.join(homeDir, ".particle", "particle.config.json")
    : "";
  let particleToken = "";
  if (particleAuthPath && fs.existsSync(particleAuthPath)) {
    const cfg = JSON.parse(fs.readFileSync(particleAuthPath, "utf8"));
    particleToken = cfg.access_token ?? "";
  }
  if (!particleToken) {
    throw new Error(
      "No Particle access token found. Run `particle login` first."
    );
  }

  const productId = process.env.PARTICLE_PRODUCT_ID;
  if (!productId) {
    throw new Error(
      "PARTICLE_PRODUCT_ID not set. Configure it in operations config.jsonc " +
        "(functions.particleProductId) and re-run `npm run generate-env`."
    );
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
  const positionalArgs: string[] = [];
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--prod") continue;
    if (args[i] === "--help" || args[i] === "-h") {
      showHelp = true;
      break;
    } else {
      positionalArgs.push(args[i]);
    }
  }

  // Gateway host/port the device should connect to. Operations config is the
  // single source of truth — generate-env.ts populates these in scripts/.env.
  const gatewayHost = process.env.GATEWAY_DEVICE_HOST;
  const gatewayPort = process.env.GATEWAY_DEVICE_PORT
    ? parseInt(process.env.GATEWAY_DEVICE_PORT, 10)
    : NaN;
  if (!gatewayHost || !Number.isFinite(gatewayPort)) {
    console.error(
      "GATEWAY_DEVICE_HOST/PORT not set. Run `npm run generate-env` first " +
        "(values come from operations config.jsonc gateway.deviceHost/devicePort)."
    );
    process.exit(1);
  }

  if (showHelp || positionalArgs.length === 0) {
    console.log(`
Usage: npm run sync-config -- <particle-device-id> [--prod]

Options:
  --prod   Read from production Firestore (default: local emulator)

Gateway target (from operations config):
  ${gatewayHost}:${gatewayPort}

Prerequisites:
  Run: particle login
  Run: cd scripts && npm install
  Run: cd functions && npm run build
`);
    process.exit(0);
  }

  if (!PROD_MODE) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    // Emulator project must match what `.firebaserc` starts the emulator as.
    // Override any stale placeholder (e.g. "local-firebase") that might be
    // in the operator's scripts/.env.local from the template.
    process.env.FIREBASE_PROJECT_ID = "oww-maco";
    console.log("Using local emulator (pass --prod for production)\n");
  } else {
    // Clear any stray emulator host that may have leaked from .env.local.
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
