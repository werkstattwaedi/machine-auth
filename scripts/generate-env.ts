// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Reads operations config.jsonc + config.local.jsonc and generates all .env files.
// Run via: npm run generate-env (or npx tsx scripts/generate-env.ts)

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
];

const FUNCTIONS_SECRETS: VarMapping[] = [
  { envVar: "DIVERSIFICATION_MASTER_KEY", jsonPath: "functions.diversificationMasterKey" },
  { envVar: "TERMINAL_KEY", jsonPath: "functions.terminalKey" },
  { envVar: "PARTICLE_WEBHOOK_API_KEY", jsonPath: "functions.particleWebhookApiKey" },
  { envVar: "PARTICLE_TOKEN", jsonPath: "functions.particleToken" },
  { envVar: "GATEWAY_API_KEY", jsonPath: "functions.gatewayApiKey" },
  { envVar: "RESEND_API_KEY", jsonPath: "functions.resendApiKey" },
];

const FUNCTIONS_RESEND: VarMapping[] = [
  { envVar: "RESEND_FROM_EMAIL", jsonPath: "functions.resendFromEmail" },
  { envVar: "RESEND_TWINT_TEMPLATE_ID", jsonPath: "functions.resendTwintTemplateId" },
  { envVar: "RESEND_QRBILL_TEMPLATE_ID", jsonPath: "functions.resendQrBillTemplateId" },
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
  { envVar: "VITE_IBAN", jsonPath: "web.iban" },
  { envVar: "VITE_TWINT_URL", jsonPath: "web.twintUrl" },
  { envVar: "VITE_PAYMENT_RECIPIENT_NAME", jsonPath: "web.paymentRecipientName" },
  { envVar: "VITE_PAYMENT_RECIPIENT_POSTAL_CODE", jsonPath: "web.paymentRecipientPostalCode" },
  { envVar: "VITE_PAYMENT_RECIPIENT_CITY", jsonPath: "web.paymentRecipientCity" },
  { envVar: "VITE_PAYMENT_RECIPIENT_COUNTRY", jsonPath: "web.paymentRecipientCountry" },
];

const FUNCTIONS_PAYMENT: VarMapping[] = [
  { envVar: "PAYMENT_IBAN", jsonPath: "web.iban" },
  { envVar: "PAYMENT_RECIPIENT_NAME", jsonPath: "web.paymentRecipientName" },
  { envVar: "PAYMENT_RECIPIENT_STREET", jsonPath: "web.paymentRecipientStreet" },
  { envVar: "PAYMENT_RECIPIENT_POSTAL_CODE", jsonPath: "web.paymentRecipientPostalCode" },
  { envVar: "PAYMENT_RECIPIENT_CITY", jsonPath: "web.paymentRecipientCity" },
  { envVar: "PAYMENT_RECIPIENT_COUNTRY", jsonPath: "web.paymentRecipientCountry" },
  { envVar: "PAYMENT_CURRENCY", jsonPath: "web.currency" },
];

const GATEWAY: VarMapping[] = [
  { envVar: "GATEWAY_HOST", jsonPath: "gateway.host" },
  { envVar: "GATEWAY_PORT", jsonPath: "gateway.port" },
  { envVar: "MASTER_KEY", jsonPath: "gateway.masterKey" },
  { envVar: "FIREBASE_URL", jsonPath: "gateway.firebaseUrl" },
  { envVar: "GATEWAY_API_KEY", jsonPath: "gateway.gatewayApiKey" },
];

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
  file: OutputFile
): string {
  const lines: string[] = [file.header, ""];

  for (const section of file.sections) {
    lines.push(section.comment);
    for (const { envVar, jsonPath } of section.vars) {
      const value = resolveValue(config, jsonPath);
      lines.push(`${envVar}=${value}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// --- Main ---

function main() {
  const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
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

  const outputFiles: OutputFile[] = [
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
          vars: [{ envVar: "FIREBASE_PROJECT_ID", jsonPath: "firebase.projectId" }],
        },
      ],
    },
  ];

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

main();
