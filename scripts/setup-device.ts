#!/usr/bin/env npx tsx
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Particle device provisioning: identify device, add to product, configure Wi-Fi.
 * Requires a device connected via USB in listening mode (blinking blue).
 *
 * Usage: npx tsx scripts/setup-device.ts
 */

import "dotenv/config";
import { execa } from "execa";

function log(msg: string) {
  console.log(msg);
}

async function runCommand(command: string, args: string[]) {
  const subprocess = execa(command, args);
  subprocess.stdout?.pipe(process.stdout);
  subprocess.stderr?.pipe(process.stderr);
  return subprocess;
}

async function main() {
  log("--- Particle Device Setup ---\n");

  // Identify device
  log("=> Identifying device...");
  const { stdout } = await execa("particle", ["identify"]);
  const match = stdout.match(/Your device id is (\w+)/);

  if (!match?.[1]) {
    throw new Error(
      "Could not find device ID. Is the device in Listening Mode (blinking blue)?"
    );
  }
  const deviceId = match[1];
  log(`   Device ID: ${deviceId}`);

  // Add to product
  const productName = process.env.PARTICLE_PRODUCT_NAME;
  if (!productName) throw new Error("PARTICLE_PRODUCT_NAME not set in .env");

  log(`\n=> Adding device to product "${productName}"...`);
  await runCommand("particle", ["product", "device", "add", productName, deviceId]);

  log("\n=> Adding device to your account...");
  await runCommand("particle", ["device", "add", deviceId]);

  // Configure Wi-Fi
  const ssid = process.env.WIFI_SSID;
  const pass = process.env.WIFI_PASS;
  if (!ssid || !pass) throw new Error("WIFI_SSID and WIFI_PASS must be set in .env");

  log(`\n=> Adding Wi-Fi credentials for "${ssid}"...`);
  await runCommand("particle", ["wifi", "add", ssid, pass]);

  log("\nDone! Device is ready.");
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
