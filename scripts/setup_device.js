#!/usr/bin/env node

import "dotenv/config";
import { execa } from "execa";
import chalk from "chalk";

const log = console.log;
const logStep = (message) => log(chalk.blue(`\n=> ${message}`));
const logSuccess = (message) => log(chalk.green(`✅ ${message}`));
const logError = (message) => log(chalk.red(`❌ ${message}`));

async function runCommand(command, args) {
  try {
    const subprocess = execa(command, args);
    // Pipe the output of the command to our script's output
    subprocess.stdout.pipe(process.stdout);
    subprocess.stderr.pipe(process.stderr);
    return await subprocess;
  } catch (error) {
    logError(`Command failed: ${command} ${args.join(" ")}`);
    throw error; // Propagate the error to stop the script
  }
}

/**
 * Main script logic
 */
async function main() {
  log(chalk.bold.yellow("--- Particle Device Setup ---"));

  // 2. Identify the device and extract its ID
  logStep("Identifying device to get its ID...");
  const { stdout } = await execa("particle", ["identify"]);
  const match = stdout.match(/Your device id is (\w+)/);

  if (!match || !match[1]) {
    throw new Error(
      "Could not find device ID. Is the device in Listening Mode (blinking blue)?"
    );
  }
  const deviceId = match[1];
  logSuccess(`Device ID found: ${deviceId}`);

  // 3. Add device to product and account
  const productName = process.env[`PARTICLE_PRODUCT_NAME`];
  logStep(`Adding device to product "${productName}"...`);
  await runCommand("particle", [
    "product",
    "device",
    "add",
    productName,
    deviceId,
  ]);

  logStep("Adding device to your account...");
  await runCommand("particle", ["device", "add", deviceId]);

  await runCommand("particle", [
    "wifi",
    "add",
    process.env[`WIFI_SSID`],
    process.env[`WIFI_PASS`],
  ]);
  logSuccess(`Wi-Fi credentials for "${process.env[`WIFI_SSID`]}" added.`);

  log(chalk.bold.yellow("\n🎉 All done! Your device is ready."));
}

main().catch((error) => {
  logError(error.message);
  process.exit(1);
});
