// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Build and deploy the MACO gateway to a Raspberry Pi.
 *
 * Architecture:
 *   The gateway runs from a Python venv on the Pi (system Python 3.11), not
 *   from a Bazel-bundled hermetic interpreter — that approach can't cross-build
 *   for aarch64 because pigweed's Bazel pip hub pulls in x86_64-only native
 *   wheels (psutil, charset_normalizer, pyyaml) we don't actually use.
 *
 *   The deploy payload contains:
 *     - maco_gateway/        gateway sources
 *     - gateway/             generated proto for the gateway service
 *     - pw_hdlc/, pw_rpc/, pw_status/, pw_protobuf_compiler/
 *                            pigweed Python sources, vendored from
 *                            third_party/pigweed (head, protobuf-6 compatible).
 *                            The PyPI `pigweed` package lags head and pins
 *                            protobuf~=5.28, which conflicts with our generated
 *                            code's runtime requirement.
 *     - requirements.txt     pip deps: httpx, ascon, python-dotenv, protobuf
 *
 * Steps:
 *   1. Build proto via Bazel (gateway service + pw_rpc/internal/packet)
 *   2. Stage payload (sources + protos + vendored pigweed + requirements.txt)
 *   3. Generate .env from config.jsonc + Google Cloud Secret Manager. When a
 *      printer host is configured (gateway.printerHost / electron.printerHost),
 *      also fetch the GATEWAY_FIRESTORE_SA service-account key for the label
 *      print worker and ship it as service-account.json.
 *   4. Multiplexed SCP/SSH: extract, create venv, pip install
 *
 * Usage:
 *   npx tsx scripts/deploy-gateway.ts --host maker1@maco-gateway.internal
 *   npx tsx scripts/deploy-gateway.ts --host maker1@maco-gateway.internal --remote-dir /opt/gateway
 *   npx tsx scripts/deploy-gateway.ts --build-only   # just build, no deploy
 *   npx tsx scripts/deploy-gateway.ts --env staging --host maker1@test-pi.internal
 *
 * `--env <name>` (ADR-0034) deep-merges the operations repo's
 * `config.<name>.jsonc` overlay before reading gateway.* values, so the
 * deployed Pi talks to that environment's Cloud Functions. Secrets still
 * come from Secret Manager via the default gcloud project — environments
 * share secret values. The env choice is baked into the shipped
 * `.env.local` at deploy time; the Pi itself has no GATEWAY_ENV notion.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  readdirSync,
} from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { parseArgs } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const configDir =
  process.env.OPERATIONS_CONFIG_DIR ||
  resolve(projectRoot, "..", "machine-auth-operations");

// --- Config helpers (same as generate-env.ts) ---

function parseJsonc(text: string): Record<string, unknown> {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      i++;
      result += text.slice(start, i);
    } else if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
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

// --- Secret Manager ---

function fetchSecret(secretName: string): string {
  console.log(`  Fetching secret: ${secretName}`);
  try {
    return execSync(
      `gcloud secrets versions access latest --secret=${secretName}`,
      { encoding: "utf-8" },
    ).trim();
  } catch {
    console.error(`Failed to fetch secret "${secretName}". Check: gcloud config get-value project`);
    process.exit(1);
  }
}

// --- Build payload ---

// Pinned pip deps for the Pi venv. Mostly pure-Python; `protobuf` and
// `google-cloud-firestore` (+ its transitive `grpcio`) ship manylinux
// aarch64 wheels on PyPI, so the venv installs without compiling. Pigweed
// Python sources are vendored (see PIGWEED_PY_PACKAGES below), not from PyPI.
// google-cloud-firestore powers the label print worker (Firestore listener);
// a printer-less gateway still installs it but never imports it at runtime.
const REQUIREMENTS_TXT = [
  "# Generated by deploy-gateway.ts — do not edit",
  "ascon==0.0.9",
  "google-cloud-firestore>=2.16,<3",
  "httpx==0.28.1",
  "protobuf>=6.33,<7",
  "python-dotenv==1.2.2",
  "",
].join("\n");

// Pigweed Python packages we vendor from third_party/pigweed/. The set is the
// transitive import closure of what maco_gateway/main.py imports. See the
// import chain reasoning in the deploy doc.
const PIGWEED_PY_PACKAGES = [
  "pw_hdlc",
  "pw_protobuf_compiler",
  "pw_rpc",
  "pw_status",
];

// (target → repo-relative destination) for protos generated by Bazel.
const PROTO_OUTPUTS: Array<{ target: string; src: string; dest: string }> = [
  {
    target: "//proto/gateway:gateway_service_py_pb2",
    src: "proto/gateway/_virtual_imports/gateway_service_proto/gateway/gateway_service_pb2.py",
    dest: "gateway/gateway_service_pb2.py",
  },
  {
    target: "@pigweed//pw_rpc:internal_packet_proto_pb2",
    src: "external/pigweed+/pw_rpc/internal/packet_pb2.py",
    dest: "pw_rpc/internal/packet_pb2.py",
  },
];

function copyDirRecursive(srcDir: string, destDir: string) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = resolve(srcDir, entry.name);
    const destPath = resolve(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

function buildPayload(): string {
  console.log("\n=== Building gateway deploy payload ===\n");

  execSync(
    `bazelisk build ${PROTO_OUTPUTS.map((p) => p.target).join(" ")}`,
    { cwd: projectRoot, stdio: "inherit" },
  );
  const bazelBin = execSync("bazelisk info bazel-bin", {
    cwd: projectRoot,
    encoding: "utf-8",
  }).trim();

  const stage = resolve(projectRoot, "out/gateway-deploy");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  // Gateway sources: top-level modules plus runtime subpackages (e.g.
  // sensing/). Test files (test_*.py) and the test-only fixtures/ package are
  // excluded from the deploy payload.
  const sourceDir = resolve(projectRoot, "maco_gateway/maco_gateway");
  const RUNTIME_SUBPACKAGES = ["sensing"];
  const isRuntimePy = (name: string) =>
    name.endsWith(".py") && !name.startsWith("test_");

  mkdirSync(resolve(stage, "maco_gateway"), { recursive: true });
  for (const file of readdirSync(sourceDir)) {
    if (isRuntimePy(file)) {
      copyFileSync(resolve(sourceDir, file), resolve(stage, "maco_gateway", file));
    }
  }
  for (const pkg of RUNTIME_SUBPACKAGES) {
    const pkgSrc = resolve(sourceDir, pkg);
    const pkgDest = resolve(stage, "maco_gateway", pkg);
    mkdirSync(pkgDest, { recursive: true });
    for (const file of readdirSync(pkgSrc)) {
      if (isRuntimePy(file)) {
        copyFileSync(resolve(pkgSrc, file), resolve(pkgDest, file));
      }
    }
  }

  // Vendored pigweed Python sources.
  for (const pkg of PIGWEED_PY_PACKAGES) {
    const src = resolve(projectRoot, `third_party/pigweed/${pkg}/py/${pkg}`);
    copyDirRecursive(src, resolve(stage, pkg));
  }

  // Generated proto modules.
  for (const proto of PROTO_OUTPUTS) {
    const destPath = resolve(stage, proto.dest);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(resolve(bazelBin, proto.src), destPath);
  }
  // pw_rpc/internal/ needs an __init__.py to be importable as a package.
  writeFileSync(resolve(stage, "pw_rpc/internal/__init__.py"), "");

  writeFileSync(resolve(stage, "requirements.txt"), REQUIREMENTS_TXT);

  const tarPath = resolve(projectRoot, "out/gateway-deploy.tar.gz");
  execSync(`tar czf ${tarPath} -C ${stage} .`, { stdio: "inherit" });
  console.log(`  Written: ${tarPath}`);
  return tarPath;
}

// --- Generate .env ---

// Filename the gateway expects its Firestore service-account key under, in
// the deploy dir. The systemd unit sets WorkingDirectory to that dir, so the
// relative GOOGLE_APPLICATION_CREDENTIALS path below resolves correctly.
const SA_FILENAME = "service-account.json";

function generateEnv(envName: string | null): {
  envPath: string;
  saPath: string | null;
} {
  console.log(`\n=== Generating ${envName ?? "production"} .env ===\n`);

  const configPath = resolve(configDir, "config.jsonc");
  let config = parseJsonc(readFileSync(configPath, "utf-8"));
  if (envName) {
    const overlayPath = resolve(configDir, `config.${envName}.jsonc`);
    if (!existsSync(overlayPath)) {
      console.error(
        `Error: ${overlayPath} not found. --env ${envName} needs the same ` +
          `overlay file scripts/generate-env.ts --env reads.`
      );
      process.exit(1);
    }
    config = deepMerge(config, parseJsonc(readFileSync(overlayPath, "utf-8")));
  }

  const masterKey = fetchSecret("GATEWAY_ASCON_MASTER_KEY");
  const gatewayApiKey = fetchSecret("GATEWAY_API_KEY");

  const firebaseUrl = resolveValue(config, "gateway.firebaseUrl");
  if (!firebaseUrl) {
    console.error("Error: gateway.firebaseUrl not found in config.jsonc");
    process.exit(1);
  }

  const lines = [
    `# Generated by deploy-gateway.ts${envName ? ` --env ${envName}` : ""} — do not edit`,
    "",
    "# MaCo Gateway",
    "GATEWAY_HOST=0.0.0.0",
    "GATEWAY_PORT=5000",
    `MASTER_KEY=${masterKey}`,
    `FIREBASE_URL=${firebaseUrl}`,
    `GATEWAY_API_KEY=${gatewayApiKey}`,
  ];

  const outDir = resolve(projectRoot, "out");
  mkdirSync(outDir, { recursive: true });

  // Label printing (optional): when a printer host is configured, the
  // gateway runs the Firestore print worker, which needs a service-account
  // key (datastore.user) provisioned in Secret Manager. Skip both when no
  // printer is configured so printer-less gateways deploy unchanged.
  const printerHost =
    resolveValue(config, "gateway.printerHost") ||
    resolveValue(config, "electron.printerHost");

  let saPath: string | null = null;
  if (printerHost) {
    const saJson = fetchSecret("GATEWAY_FIRESTORE_SA");
    saPath = resolve(outDir, SA_FILENAME);
    writeFileSync(saPath, saJson.endsWith("\n") ? saJson : `${saJson}\n`);
    console.log(`  Written: ${saPath}`);
    lines.push(
      "",
      "# Label printing (Firestore print worker)",
      `PRINTER_HOST=${printerHost}`,
      // Relative path — resolved against the systemd WorkingDirectory.
      `GOOGLE_APPLICATION_CREDENTIALS=${SA_FILENAME}`,
    );
  } else {
    console.log(
      "  No gateway.printerHost / electron.printerHost in config — " +
        "skipping print worker (no PRINTER_HOST, no service account).",
    );
  }
  lines.push("");

  const envPath = resolve(outDir, "gateway.env");
  writeFileSync(envPath, lines.join("\n"));
  console.log(`  Written: ${envPath}`);
  return { envPath, saPath };
}

// --- Deploy ---

function deploy(
  payloadPath: string,
  envPath: string,
  saPath: string | null,
  host: string,
  remoteDir: string,
) {
  console.log(`\n=== Deploying to ${host}:${remoteDir} ===\n`);

  // Multiplex all ssh/scp calls over a single connection so the user types
  // the password (or unlocks their key) at most once. The first command
  // opens the master; the rest reuse the control socket.
  const ctlSocket = `/tmp/ssh-deploy-gateway-${process.pid}.sock`;
  const sshOpts = `-o ControlMaster=auto -o ControlPath=${ctlSocket} -o ControlPersist=60s`;

  // Single remote script: extract payload, ensure venv, sync deps, write a
  // systemd unit pinned to the deploy user/dir. `pip install -r` and the
  // unit-file rewrite are both idempotent. The heredoc terminator is
  // unquoted so $(whoami)/$(pwd) expand on the Pi.
  const remoteScript = `set -e
mkdir -p ${remoteDir}
cd ${remoteDir}
tar xzf /tmp/gateway-deploy.tar.gz
rm /tmp/gateway-deploy.tar.gz
[ -d venv ] || python3 -m venv venv
venv/bin/pip install --quiet --upgrade pip
venv/bin/pip install --quiet -r requirements.txt
cat > gateway.service <<UNIT_EOF
[Unit]
Description=MaCo Gateway (pw_rpc proxy to Firebase)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/venv/bin/python -m maco_gateway.main
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT_EOF`;

  try {
    execSync(`scp ${sshOpts} ${payloadPath} ${host}:/tmp/gateway-deploy.tar.gz`, {
      stdio: "inherit",
    });
    execSync(`ssh ${sshOpts} ${host} '${remoteScript}'`, { stdio: "inherit" });
    // main.py only looks for `.env.local` (matching the local-dev convention
    // generated by scripts/generate-env.ts), not `.env`.
    execSync(`scp ${sshOpts} ${envPath} ${host}:${remoteDir}/.env.local`, { stdio: "inherit" });
    // Firestore service-account key for the print worker (only when a
    // printer is configured). Referenced by GOOGLE_APPLICATION_CREDENTIALS
    // in .env.local, relative to the systemd WorkingDirectory.
    if (saPath) {
      execSync(`scp ${sshOpts} ${saPath} ${host}:${remoteDir}/${SA_FILENAME}`, {
        stdio: "inherit",
      });
    }
  } finally {
    try {
      execSync(`ssh ${sshOpts} -O exit ${host}`, { stdio: "ignore" });
    } catch {
      // Master already torn down (e.g. earlier command failed before opening it).
    }
  }

  console.log(`
Deployed.

Run once (manual):
  ssh ${host} 'cd ${remoteDir} && venv/bin/python -m maco_gateway.main'

Install as a systemd service (one-time, requires sudo on the Pi):
  ssh ${host} 'sudo install -m 644 ${remoteDir}/gateway.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now gateway'

After future deploys, restart the service:
  ssh ${host} sudo systemctl restart gateway

Logs (journald):
  ssh ${host} journalctl -u gateway -f
  ssh ${host} journalctl -u gateway --since today

Persistent logs across reboots (one-time, if /var/log/journal/ doesn't exist):
  ssh ${host} 'sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald'
`);
}

// --- Main ---

function main() {
  const { values } = parseArgs({
    options: {
      host: { type: "string", short: "h" },
      "remote-dir": { type: "string", default: "~/gateway" },
      "build-only": { type: "boolean", default: false },
      env: { type: "string" },
    },
    strict: true,
  });

  if (!values["build-only"] && !values.host) {
    console.error("Usage: deploy-gateway.ts --host maker1@maco-gateway.internal [--remote-dir ~/gateway] [--env staging]");
    console.error("       deploy-gateway.ts --build-only");
    process.exit(1);
  }

  const payloadPath = buildPayload();
  const { envPath, saPath } = generateEnv(values.env ?? null);

  if (values["build-only"]) {
    console.log(`\nBuild complete:`);
    console.log(`  Payload: ${payloadPath}`);
    console.log(`  ENV:     ${envPath}`);
    if (saPath) console.log(`  SA key:  ${saPath}`);
  } else {
    deploy(payloadPath, envPath, saPath, values.host!, values["remote-dir"]!);
  }
}

main();
