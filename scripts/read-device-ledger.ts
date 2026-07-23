#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
//
// READ-ONLY: dump the DeviceConfig currently stored in a device's Particle
// ledger ("terminal-config"). Used to recover the exact gateway_sensing
// control values (host/port/timeouts) the working device is running, after
// the Firestore machine doc lost them to a reseed.
//
// Prereqs: `particle login`; PARTICLE_PRODUCT_ID in scripts/.env; functions built.
//
//   npx tsx scripts/read-device-ledger.ts [particle-device-id]
//
// Defaults to the Laser Cutter's maco device.

import { config as loadEnv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { DeviceConfig } from "../functions/lib/src/proto/particle/device_config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: [path.join(__dirname, ".env"), path.join(__dirname, ".env.local")] });

const DEVICE_ID = process.argv[2] ?? "0a10aced202194944a042eb0"; // Laser Cutter maco
const LEDGER_NAME = "terminal-config";

async function main() {
  const productId = process.env.PARTICLE_PRODUCT_ID;
  if (!productId) throw new Error("PARTICLE_PRODUCT_ID not set (scripts/.env)");

  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const authPath = path.join(homeDir, ".particle", "particle.config.json");
  if (!fs.existsSync(authPath)) throw new Error("Run `particle login` first.");
  const token = JSON.parse(fs.readFileSync(authPath, "utf8")).access_token ?? "";
  if (!token) throw new Error("No Particle access token; run `particle login`.");

  const Particle = (await import("particle-api-js")).default;
  const particle = new Particle();

  const res = await particle.getLedgerInstance({
    product: productId,
    ledgerName: LEDGER_NAME,
    scopeValue: DEVICE_ID,
    auth: token,
  });

  const b64 = res.body?.instance?.data?.["device_config.proto.b64"];
  if (!b64) {
    console.log("No device_config.proto.b64 in ledger instance. Raw body:");
    console.log(JSON.stringify(res.body, null, 2));
    return;
  }

  const cfg = DeviceConfig.decode(Buffer.from(b64, "base64"));
  console.log(`Ledger '${LEDGER_NAME}' for device ${DEVICE_ID}:`);
  console.log(`  gatewayHost=${cfg.gatewayHost}  gatewayPort=${cfg.gatewayPort}\n`);
  for (const m of cfg.machines) {
    console.log(`machine id=${m.id?.value}  label=${JSON.stringify(m.label)}`);
    const c = m.control?.control;
    if (c?.$case === "gatewaySensing") {
      const gs = c.gatewaySensing;
      const spec = gs.spec?.backend;
      console.log(`  control = gateway_sensing`);
      console.log(`    idleTimeoutSec=${gs.idleTimeoutSec}  idleWarningSec=${gs.idleWarningSec}`);
      if (spec?.$case === "xtoolLaser") {
        console.log(
          `    kind=xtool_laser  host=${JSON.stringify(spec.xtoolLaser.host)}` +
            `  port=${spec.xtoolLaser.port}  pollIntervalSec=${spec.xtoolLaser.pollIntervalSec}`,
        );
      } else {
        console.log(`    spec=${JSON.stringify(spec)}`);
      }
    } else {
      console.log(`  control = ${c?.$case ?? "(none)"}`);
    }
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
