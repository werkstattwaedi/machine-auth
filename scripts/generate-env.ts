// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Reads operations config.jsonc + config.local.jsonc and generates all .env files.
// Run via: npm run generate-env (or npx tsx scripts/generate-env.ts)
//
// With `--emit-test-files`, emits a parallel set of `.env.test` fixtures
// instead of the normal `.env.local` / `.env.development` outputs. These
// fixtures hold only dummy/public values (TEST_FIXTURE_OVERRIDES below)
// and are committed to git so CI runners that cannot clone the operations
// repo can still boot the emulator suite + Playwright for presubmit e2e.
// In this mode an embedded TEST_FIXTURE_CONFIG drives the resolver so the
// command works even without the operations repo present.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// --- Types ---

interface VarMapping {
  envVar: string;
  jsonPath: string; // dot-separated, e.g. "firebase.projectId"
}

interface OutputSection {
  comment: string;
  vars: VarMapping[];
}

interface OutputFile {
  path: string; // relative to project root
  source: "production" | "local";
  header: string;
  sections: OutputSection[];
}

// --- Reusable var groups ---

const FUNCTIONS_PARAMS: VarMapping[] = [
  { envVar: "DIVERSIFICATION_SYSTEM_NAME", jsonPath: "functions.diversificationSystemName" },
  { envVar: "PARTICLE_PRODUCT_ID", jsonPath: "functions.particleProductId" },
  { envVar: "LOGIN_ALLOWED_ORIGINS", jsonPath: "functions.loginAllowedOrigins" },
  // Login-code rate-limit knobs (issue #152). Operations-tunable so values
  // can be retuned without a code change; CLAUDE.md keeps the docs.
  { envVar: "LOGIN_PER_EMAIL_WINDOW_MS", jsonPath: "functions.loginPerEmailWindowMs" },
  { envVar: "LOGIN_MAX_CODES_PER_EMAIL", jsonPath: "functions.loginMaxCodesPerEmail" },
  { envVar: "LOGIN_MAX_ATTEMPTS_PER_EMAIL", jsonPath: "functions.loginMaxAttemptsPerEmail" },
  // Checkout domain (issue #248) drives the QR-code deep link printed on
  // price-list PDFs. Reuses `web.checkoutDomain` from the operations
  // config so admin web + functions stay in sync.
  { envVar: "CHECKOUT_DOMAIN", jsonPath: "web.checkoutDomain" },
];

const FUNCTIONS_SECRETS: VarMapping[] = [
  { envVar: "DIVERSIFICATION_MASTER_KEY", jsonPath: "functions.diversificationMasterKey" },
  { envVar: "TERMINAL_KEY", jsonPath: "functions.terminalKey" },
  { envVar: "PARTICLE_TOKEN", jsonPath: "functions.particleToken" },
  { envVar: "GATEWAY_API_KEY", jsonPath: "functions.gatewayApiKey" },
  { envVar: "RESEND_API_KEY", jsonPath: "functions.resendApiKey" },
];

const FUNCTIONS_RESEND: VarMapping[] = [
  { envVar: "RESEND_FROM_EMAIL", jsonPath: "functions.resendFromEmail" },
  { envVar: "RESEND_TWINT_TEMPLATE_ID", jsonPath: "functions.resendTwintTemplateId" },
  { envVar: "RESEND_QRBILL_TEMPLATE_ID", jsonPath: "functions.resendQrBillTemplateId" },
  { envVar: "RESEND_LOGIN_TEMPLATE_ID", jsonPath: "functions.resendLoginTemplateId" },
  { envVar: "RESEND_INVITE_TEMPLATE_ID", jsonPath: "functions.resendInviteTemplateId" },
];

const VITE_FIREBASE: VarMapping[] = [
  { envVar: "VITE_FIREBASE_API_KEY", jsonPath: "firebase.apiKey" },
  { envVar: "VITE_FIREBASE_AUTH_DOMAIN", jsonPath: "firebase.authDomain" },
  { envVar: "VITE_FIREBASE_PROJECT_ID", jsonPath: "firebase.projectId" },
  { envVar: "VITE_FIREBASE_STORAGE_BUCKET", jsonPath: "firebase.storageBucket" },
  { envVar: "VITE_FIREBASE_MESSAGING_SENDER_ID", jsonPath: "firebase.messagingSenderId" },
  { envVar: "VITE_FIREBASE_APP_ID", jsonPath: "firebase.appId" },
];

const VITE_DEPLOYMENT: VarMapping[] = [
  { envVar: "VITE_CHECKOUT_DOMAIN", jsonPath: "web.checkoutDomain" },
  { envVar: "VITE_FUNCTIONS_REGION", jsonPath: "firebase.region" },
  { envVar: "VITE_LOCALE", jsonPath: "web.locale" },
  { envVar: "VITE_CURRENCY", jsonPath: "web.currency" },
  { envVar: "VITE_ORGANIZATION_NAME", jsonPath: "web.organizationName" },
];

const FUNCTIONS_PAYMENT: VarMapping[] = [
  { envVar: "PAYMENT_IBAN", jsonPath: "web.iban" },
  { envVar: "PAYMENT_RECIPIENT_NAME", jsonPath: "web.paymentRecipientName" },
  { envVar: "PAYMENT_RECIPIENT_STREET", jsonPath: "web.paymentRecipientStreet" },
  { envVar: "PAYMENT_RECIPIENT_POSTAL_CODE", jsonPath: "web.paymentRecipientPostalCode" },
  { envVar: "PAYMENT_RECIPIENT_CITY", jsonPath: "web.paymentRecipientCity" },
  { envVar: "PAYMENT_RECIPIENT_COUNTRY", jsonPath: "web.paymentRecipientCountry" },
  { envVar: "PAYMENT_CURRENCY", jsonPath: "web.currency" },
  { envVar: "RAISENOW_PAYLINK_SOLUTION_ID", jsonPath: "web.raisenowPaylinkSolutionId" },
];

const GATEWAY: VarMapping[] = [
  { envVar: "GATEWAY_HOST", jsonPath: "gateway.host" },
  { envVar: "GATEWAY_PORT", jsonPath: "gateway.port" },
  { envVar: "MASTER_KEY", jsonPath: "gateway.masterKey" },
  { envVar: "FIREBASE_URL", jsonPath: "gateway.firebaseUrl" },
  { envVar: "GATEWAY_API_KEY", jsonPath: "gateway.gatewayApiKey" },
];

// --- Test fixtures ---
//
// Values used when emitting `.env.test` files (`--emit-test-files`).
// Two sources stack:
//
//   1. `TEST_FIXTURE_CONFIG` — a synthesized operations config with
//      emulator-safe defaults. Mirrors the public + local-overrides
//      shape (firebase emulator project, fake API key, payment / web
//      branding) so the resolver produces sensible values without
//      requiring the operations repo to be cloned.
//
//   2. `TEST_FIXTURE_OVERRIDES` — per-envVar literal overrides applied
//      after `resolveValue`. Used for anything that doesn't naturally
//      come from the config tree (test crypto keys hard-coded in
//      `e2e/global-setup.ts`, dummy Resend / Particle / gateway keys
//      that must NEVER hold real production values).
//
// The values below are public-safe by construction:
//   - `TERMINAL_KEY`/`MASTER_KEY` match the e2e seed (`global-setup.ts`)
//     and are inert without an NTAG424 tag personalized with them.
//   - `RESEND_API_KEY` uses the standard test-key prefix.
//   - `PARTICLE_TOKEN` is a placeholder; firmware paths are not exercised
//     by the web e2e suite.
//   - `RAISENOW_PAYLINK_SOLUTION_ID` uses `test-fake-solution`; the e2e
//     suite doesn't hit RaiseNow.
const TEST_FIXTURE_CONFIG: Record<string, unknown> = {
  firebase: {
    projectId: "oww-maco",
    region: "us-central1",
    apiKey: "fake-api-key",
    authDomain: "checkout.werkstattwaedi.ch",
    storageBucket: "oww-maco.firebasestorage.app",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:000000000000",
  },
  functions: {
    diversificationSystemName: "Oww8820Maco",
    particleProductId: "ci-test-product",
    loginAllowedOrigins: "https://localhost:5188,https://localhost:5189",
    loginPerEmailWindowMs: "86400000",
    loginMaxCodesPerEmail: "20",
    loginMaxAttemptsPerEmail: "30",
    resendFromEmail: "OWW CI <ci@test.localhost>",
    resendQrBillTemplateId: "ci-test-qrbill-template",
    resendLoginTemplateId: "ci-test-login-template",
    resendInviteTemplateId: "ci-test-invite-template",
    resendTwintTemplateId: "",
  },
  web: {
    checkoutDomain: "localhost:5188",
    locale: "de-CH",
    currency: "CHF",
    organizationName: "Verein Offene Werkstatt Wädenswil (CI)",
    iban: "CH00 0000 0000 0000 0000 0",
    raisenowPaylinkSolutionId: "test-fake-solution",
    paymentRecipientName: "OWW CI Recipient",
    paymentRecipientStreet: "Teststrasse 1",
    paymentRecipientPostalCode: "0000",
    paymentRecipientCity: "Teststadt",
    paymentRecipientCountry: "CH",
  },
  nfc: {
    sdmBaseUrl: "id.test.localhost/",
  },
  gateway: {
    host: "0.0.0.0",
    port: 5000,
    masterKey: "000102030405060708090a0b0c0d0e0f",
    firebaseUrl: "http://127.0.0.1:5101/oww-maco/us-central1",
    gatewayApiKey: "ci-test-gateway-key",
    deviceHost: "maco-gateway.internal",
    devicePort: 5000,
  },
};

const TEST_FIXTURE_OVERRIDES: Record<string, string> = {
  // Crypto keys baked into the e2e seed (`global-setup.ts`). Inert
  // without an NTAG424 tag personalized with them.
  DIVERSIFICATION_MASTER_KEY: "c025f541727ecd8b6eb92055c88a2a70",
  TERMINAL_KEY: "f5e4b999d5aa629f193a874529c4aa2f",
  // Dummy / standard test prefixes — no real production credentials.
  PARTICLE_TOKEN: "ci-test-particle-token",
  GATEWAY_API_KEY: "ci-test-gateway-key",
  RESEND_API_KEY: "re_test_fake_ci_key",
};

// --- Helpers ---

function parseJsonc(text: string): Record<string, unknown> {
  // Strip comments while preserving strings that may contain // or /*
  let result = "";
  let i = 0;
  while (i < text.length) {
    // Skip double-quoted strings
    if (text[i] === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++; // skip escaped char
        i++;
      }
      i++; // closing quote
      result += text.slice(start, i);
    } else if (text[i] === "/" && text[i + 1] === "/") {
      // Single-line comment — skip to end of line
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
      // Multi-line comment — skip to */
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += text[i];
      i++;
    }
  }
  return JSON.parse(result);
}

function resolveValue(config: Record<string, unknown>, jsonPath: string): string {
  const parts = jsonPath.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  if (current == null) return "";
  return String(current);
}

function deepMerge(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(overrides)) {
    if (
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key]) &&
      typeof overrides[key] === "object" &&
      overrides[key] !== null &&
      !Array.isArray(overrides[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        overrides[key] as Record<string, unknown>
      );
    } else {
      result[key] = overrides[key];
    }
  }
  return result;
}

function generateEnvContent(
  config: Record<string, unknown>,
  file: OutputFile,
  overrides: Record<string, string> = {}
): string {
  const lines: string[] = [file.header, ""];

  for (const section of file.sections) {
    lines.push(section.comment);
    for (const { envVar, jsonPath } of section.vars) {
      const value =
        envVar in overrides ? overrides[envVar] : resolveValue(config, jsonPath);
      lines.push(`${envVar}=${value}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  const emitTestFiles = args.includes("--emit-test-files");

  const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

  // Test-file mode is self-contained — it uses the embedded
  // TEST_FIXTURE_CONFIG and does not require the operations repo. This
  // lets CI runners regenerate / verify fixtures without secrets.
  if (emitTestFiles) {
    emitTestFixtures(projectRoot);
    return;
  }

  const configDir =
    process.env.OPERATIONS_CONFIG_DIR ||
    resolve(projectRoot, "..", "machine-auth-operations");

  const configPath = resolve(configDir, "config.jsonc");
  const localConfigPath = resolve(configDir, "config.local.jsonc");

  if (!existsSync(configPath)) {
    console.error(
      `Error: ${configPath} not found.\n\n` +
        "Clone the operations repo as a sibling directory:\n" +
        "  cd .. && git clone <operations-repo-url> machine-auth-operations\n\n" +
        "Or set OPERATIONS_CONFIG_DIR to point to your config directory."
    );
    process.exit(1);
  }

  const prodConfig = parseJsonc(readFileSync(configPath, "utf-8"));
  const localOverrides = existsSync(localConfigPath)
    ? parseJsonc(readFileSync(localConfigPath, "utf-8"))
    : {};
  const localConfig = deepMerge(prodConfig, localOverrides);

  const projectId = resolveValue(prodConfig, "firebase.projectId");
  if (!projectId) {
    console.error("Error: firebase.projectId is required in config.jsonc");
    process.exit(1);
  }

  const header = "# Generated by scripts/generate-env.ts — do not edit";

  const outputFiles = buildOutputFiles({ projectId, header, mode: "default" });

  // Generate env files
  for (const file of outputFiles) {
    const config = file.source === "local" ? localConfig : prodConfig;
    const content = generateEnvContent(config, file);
    const fullPath = resolve(projectRoot, file.path);
    writeFileSync(fullPath, content);
    console.log(`  ✓ ${file.path}`);
  }

  // Generate .firebaserc
  const firebaserc = JSON.stringify(
    {
      projects: { default: projectId },
      targets: {
        [projectId]: {
          hosting: {
            checkout: [projectId],
            admin: [`${projectId}-admin`],
          },
        },
      },
    },
    null,
    2
  ) + "\n";
  writeFileSync(resolve(projectRoot, ".firebaserc"), firebaserc);
  console.log("  ✓ .firebaserc");

  console.log("\nDone. Generated env files from", configDir);
}

function buildOutputFiles(opts: {
  projectId: string;
  header: string;
  mode: "default" | "test";
}): OutputFile[] {
  const { header, mode } = opts;
  if (mode === "test") {
    // In test mode we only emit the "local" / development variants — the
    // checked-in fixtures are the local-dev equivalents that CI uses to
    // run the emulator suite. Production deploys never read .env.test.
    return [
      {
        path: "functions/.env.test",
        source: "local",
        header,
        sections: [
          { comment: "# Firebase Functions — parameters", vars: FUNCTIONS_PARAMS },
          { comment: "# Firebase Functions — test secrets (emulator only)", vars: FUNCTIONS_SECRETS },
          { comment: "# Firebase Functions — payment config", vars: FUNCTIONS_PAYMENT },
          { comment: "# Firebase Functions — Resend email", vars: FUNCTIONS_RESEND },
        ],
      },
      {
        path: "web/apps/checkout/.env.test",
        source: "local",
        header,
        sections: [
          { comment: "# Firebase (emulator)", vars: VITE_FIREBASE },
          { comment: "# Deployment", vars: VITE_DEPLOYMENT },
        ],
      },
      {
        path: "web/apps/admin/.env.test",
        source: "local",
        header,
        sections: [
          { comment: "# Firebase (emulator)", vars: VITE_FIREBASE },
          { comment: "# Deployment", vars: VITE_DEPLOYMENT },
        ],
      },
    ];
  }

  const { projectId } = opts;
  return [
    {
      path: "functions/.env.local",
      source: "local",
      header,
      sections: [
        { comment: "# Firebase Functions — parameters", vars: FUNCTIONS_PARAMS },
        { comment: "# Firebase Functions — test secrets (emulator only)", vars: FUNCTIONS_SECRETS },
        { comment: "# Firebase Functions — payment config", vars: FUNCTIONS_PAYMENT },
        { comment: "# Firebase Functions — Resend email", vars: FUNCTIONS_RESEND },
      ],
    },
    {
      path: `functions/.env.${projectId}`,
      source: "production",
      header: header + "\n# No FIREBASE_* prefix keys (reserved by Firebase CLI)",
      sections: [
        { comment: "# Firebase Functions — parameters (secrets via Secret Manager)", vars: FUNCTIONS_PARAMS },
        { comment: "# Firebase Functions — payment config", vars: FUNCTIONS_PAYMENT },
        { comment: "# Firebase Functions — Resend email", vars: FUNCTIONS_RESEND },
      ],
    },
    // Checkout app
    {
      path: "web/apps/checkout/.env.development",
      source: "local",
      header,
      sections: [
        { comment: "# Firebase (emulator)", vars: VITE_FIREBASE },
        { comment: "# Deployment", vars: VITE_DEPLOYMENT },
      ],
    },
    {
      path: "web/apps/checkout/.env.production",
      source: "production",
      header,
      sections: [
        { comment: "# Firebase", vars: VITE_FIREBASE },
        { comment: "# Deployment", vars: VITE_DEPLOYMENT },
      ],
    },
    // Admin app
    {
      path: "web/apps/admin/.env.development",
      source: "local",
      header,
      sections: [
        { comment: "# Firebase (emulator)", vars: VITE_FIREBASE },
        { comment: "# Deployment", vars: VITE_DEPLOYMENT },
      ],
    },
    {
      path: "web/apps/admin/.env.production",
      source: "production",
      header,
      sections: [
        { comment: "# Firebase", vars: VITE_FIREBASE },
        { comment: "# Deployment", vars: VITE_DEPLOYMENT },
      ],
    },
    {
      path: "maco_gateway/.env.local",
      source: "local",
      header,
      sections: [{ comment: "# MaCo Gateway", vars: GATEWAY }],
    },
    {
      path: "scripts/.env",
      source: "production",
      header,
      sections: [
        { comment: "# Firebase Functions — parameters", vars: FUNCTIONS_PARAMS },
        { comment: "# Firebase", vars: VITE_FIREBASE },
        { comment: "# Deployment", vars: VITE_DEPLOYMENT },
        {
          comment: "# NFC",
          vars: [{ envVar: "SDM_BASE_URL", jsonPath: "nfc.sdmBaseUrl" }],
        },
        {
          comment: "# Scripts",
          vars: [
            { envVar: "FIREBASE_PROJECT_ID", jsonPath: "firebase.projectId" },
            { envVar: "GATEWAY_DEVICE_HOST", jsonPath: "gateway.deviceHost" },
            { envVar: "GATEWAY_DEVICE_PORT", jsonPath: "gateway.devicePort" },
          ],
        },
      ],
    },
  ];
}

function emitTestFixtures(projectRoot: string) {
  const projectId = resolveValue(TEST_FIXTURE_CONFIG, "firebase.projectId");
  const header =
    "# Generated by scripts/generate-env.ts --emit-test-files — do not edit\n" +
    "# Committed to git so CI runners can boot emulators + Playwright\n" +
    "# without the operations repo. Contains only dummy / public values.";

  const outputFiles = buildOutputFiles({ projectId, header, mode: "test" });

  for (const file of outputFiles) {
    const content = generateEnvContent(
      TEST_FIXTURE_CONFIG,
      file,
      TEST_FIXTURE_OVERRIDES
    );
    const fullPath = resolve(projectRoot, file.path);
    writeFileSync(fullPath, content);
    console.log(`  ✓ ${file.path}`);
  }

  console.log("\nDone. Emitted .env.test fixtures.");
}

main();
