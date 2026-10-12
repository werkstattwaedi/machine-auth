// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Build the checkout-kiosk Windows installer for staging or production
 * (ADR-0045): preflight → release → build → record.
 *
 *   1. Refuse unless both repos are on the latest main (deploy-preflight.ts;
 *      override --allow-off-main / DEPLOY_ALLOW_OFF_MAIN=1, recorded).
 *   2. Name the release (scripts/release.ts): reuse the commit's
 *      vYYYY.M.N tag or cut the next one after a confirmation.
 *   3. Bake URL, bearer and version into the binary
 *      (checkout-kiosk/scripts/inject-build-config.mjs), compile, and run
 *      electron-builder with that version — it becomes `app.getVersion()`,
 *      the tray tooltip, the installer name and the Windows file version
 *      (2026.10.3 → 2026.10.3.0).
 *   4. Record the build. The installer still has to be installed on the
 *      kiosk PC by hand; until it reports its status (phase 2c) the record
 *      says "built", not "running".
 *
 * Usage (or `npm run build:kiosk:staging|prod` in checkout-kiosk/):
 *   npx tsx scripts/deploy-kiosk.ts --env staging [--yes] [--new-release] [--allow-off-main]
 *
 * `--dev` (`npm run build:kiosk`) builds a local, native-platform binary
 * against localhost: no preflight, no release, no record — but it still
 * carries the checkout's version (`2026.10.3-dev.4+g…`), so it never looks
 * older than the release it was built after.
 */

import { execSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

import { ENVS, type DeployEnv } from "./deploy-log.ts";
import { enforcePreflight } from "./deploy-preflight.ts";
import { buildVersion } from "./build-version.ts";
import { recordDeploy } from "./deploy-record.ts";
import { ensureReleaseOrExit } from "./release.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kioskDir = resolve(projectRoot, "checkout-kiosk");

function run(command: string, env: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n$ ${command}`);
  execSync(command, { cwd: kioskDir, stdio: "inherit", env });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      env: { type: "string" },
      dev: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      "new-release": { type: "boolean", default: false },
      "allow-off-main": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.dev) {
    const version = buildVersion();
    const devEnv = { ...process.env, BUILD_VERSION: version, KIOSK_DIST: "dev" };
    run("node scripts/inject-build-config.mjs", devEnv);
    run("npm run tsc:main", devEnv);
    run("npm run tsc:renderer", devEnv);
    run(
      `npx electron-builder --config electron-builder.kiosk.yml -c.extraMetadata.version=${version}`,
      devEnv
    );
    return;
  }

  const env = values.env as DeployEnv | undefined;
  if (!env || !ENVS.includes(env)) {
    console.error(`--env must be one of: ${ENVS.join(", ")} (or --dev)`);
    process.exit(2);
  }

  enforcePreflight("kiosk", values["allow-off-main"]);
  const { version } = await ensureReleaseOrExit({
    yes: values.yes,
    newRelease: values["new-release"],
    question: `build the ${env} kiosk installer`,
  });

  const buildEnv = { ...process.env, BUILD_VERSION: version, KIOSK_DIST: env };
  run(`node scripts/inject-build-config.mjs ${env === "prod" ? "--prod" : `--env ${env}`}`, buildEnv);
  run("npm run tsc:main", buildEnv);
  run("npm run tsc:renderer", buildEnv);
  run(
    `npx electron-builder --config electron-builder.kiosk.yml --win -c.extraMetadata.version=${version}`,
    buildEnv
  );

  // Best effort: the installer exists even if the record fails.
  try {
    await recordDeploy({
      kind: "deploy",
      env,
      component: "kiosk",
      version,
      note: "installer built; install on the kiosk PC by hand",
    });
  } catch (e) {
    console.warn(`Kiosk build not recorded: ${(e as Error).message}`);
  }
}

void main();
