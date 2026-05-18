// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Port-block broker for parallel test isolation.
//
// Acquires the lowest-numbered free CI port block, generates an offset
// firebase.runtime.<block>.json from firebase.e2e.json, exports the offset
// + per-emulator port env vars, then execs the wrapped command. The lock
// socket is held for the lifetime of this process — when the child exits,
// the kernel closes the socket and the block is released.
//
// Usage:
//   npx tsx scripts/port-block.ts -- <command> [args...]
//   e.g. npx tsx scripts/port-block.ts -- npm run test:web:integration
//
// Exit codes:
//   <child exit code> — wrapped command exited normally
//   75 (EX_TEMPFAIL)  — every CI block is currently held; caller may retry

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface BlockSpec {
  name: string;
  offset: number;
}

interface BlocksConfig {
  lockPort: number;
  blocks: BlockSpec[];
}

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const blocksConfigPath = resolve(projectRoot, "scripts/port-blocks.json");
const baseE2eConfigPath = resolve(projectRoot, "firebase.e2e.json");

function tryAcquire(port: number): Promise<{ release: () => void } | null> {
  return new Promise((resolveBind) => {
    const server = createServer();
    server.unref(); // don't keep the event loop alive on this socket alone
    server.once("error", (err) => {
      // Most common: EADDRINUSE — block already taken
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") {
        console.error(`[port-block] Unexpected error binding ${port}: ${err}`);
      }
      resolveBind(null);
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      resolveBind({ release: () => server.close() });
    });
  });
}

function applyOffsetToFirebaseConfig(
  basePath: string,
  outputPath: string,
  offset: number
): void {
  const raw = JSON.parse(readFileSync(basePath, "utf-8")) as Record<
    string,
    unknown
  >;
  const emulators = (raw.emulators ?? {}) as Record<
    string,
    { port?: number } | unknown
  >;
  raw.emulators = emulators;
  for (const key of Object.keys(emulators)) {
    const value = emulators[key];
    if (
      typeof value === "object" &&
      value !== null &&
      "port" in value &&
      typeof (value as { port: unknown }).port === "number"
    ) {
      (value as { port: number }).port += offset;
    }
  }
  // Pin hub + logging explicitly so concurrent blocks don't all start
  // probing from the default 4400/4500 and pick neighbouring ports
  // non-deterministically.
  if (!emulators.hub) emulators.hub = { port: 4400 + offset };
  if (!emulators.logging) emulators.logging = { port: 4500 + offset };
  writeFileSync(outputPath, JSON.stringify(raw, null, 2) + "\n");
}

function shiftedKillPorts(basePath: string, offset: number): number[] {
  const raw = JSON.parse(readFileSync(basePath, "utf-8")) as Record<
    string,
    unknown
  >;
  const emulators =
    (raw.emulators as Record<string, { port?: number }> | undefined) ?? {};
  const ports: number[] = [];
  for (const value of Object.values(emulators)) {
    if (typeof value?.port === "number") {
      ports.push(value.port + offset);
    }
  }
  // emulator-exec.sh also kills hub/logging defaults
  ports.push(4400 + offset, 4500 + offset);
  return [...new Set(ports)].sort((a, b) => a - b);
}

async function main(): Promise<never> {
  const sepIdx = process.argv.indexOf("--");
  if (sepIdx === -1 || sepIdx === process.argv.length - 1) {
    console.error(
      "Usage: tsx scripts/port-block.ts -- <command> [args...]\n" +
        "Example: tsx scripts/port-block.ts -- npm run test:web:integration"
    );
    process.exit(64); // EX_USAGE
  }
  const cmd = process.argv[sepIdx + 1];
  const cmdArgs = process.argv.slice(sepIdx + 2);

  // First-level invocations regenerate env files when the operations
  // config is available locally. Without this, a stale .env (e.g. a new
  // param added to config.jsonc but not yet reflected in
  // functions/.env.local) makes Firebase prompt interactively during
  // emulator startup and the test run hangs forever. CI runners don't
  // have the operations repo cloned — they materialize env files via
  // other means (committed fixtures, secrets injection) — so we silently
  // skip when the config isn't present. Nested invocations skip this
  // entirely; the parent already handled it.
  if (!process.env.PORT_BLOCK) {
    const configDir =
      process.env.OPERATIONS_CONFIG_DIR ||
      resolve(projectRoot, "..", "machine-auth-operations");
    const configPath = resolve(configDir, "config.jsonc");
    if (existsSync(configPath)) {
      const gen = spawnSync(
        "npx",
        ["tsx", resolve(projectRoot, "scripts/generate-env.ts")],
        { stdio: "inherit", cwd: projectRoot }
      );
      if (gen.status !== 0) {
        console.error(
          `[port-block] generate-env failed (exit ${gen.status}); aborting`
        );
        process.exit(gen.status ?? 1);
      }
    } else {
      console.error(
        `[port-block] Skipping generate-env (no operations config at ${configPath})`
      );
    }
  }

  // Nesting guard: if a parent already acquired a block (e.g. test:precommit
  // wrapping test:web:integration which itself wraps the broker), skip the
  // acquisition and just exec the child with the parent's env intact.
  if (process.env.PORT_BLOCK) {
    console.error(
      `[port-block] Re-using parent block ${process.env.PORT_BLOCK} (offset=${process.env.PORT_OFFSET})`
    );
    const child = spawn(cmd, cmdArgs, { stdio: "inherit", env: process.env });
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(sig, () => {
        if (!child.killed) child.kill(sig);
      });
    }
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
    child.on("error", (err) => {
      console.error(`[port-block] Failed to spawn child: ${err.message}`);
      process.exit(127);
    });
    await new Promise(() => {});
  }

  if (!existsSync(blocksConfigPath)) {
    console.error(`[port-block] Missing config: ${blocksConfigPath}`);
    process.exit(78); // EX_CONFIG
  }
  const config = JSON.parse(
    readFileSync(blocksConfigPath, "utf-8")
  ) as BlocksConfig;

  let acquired: { block: BlockSpec; release: () => void } | null = null;
  for (const block of config.blocks) {
    const port = config.lockPort + block.offset;
    const lock = await tryAcquire(port);
    if (lock) {
      acquired = { block, release: lock.release };
      console.error(
        `[port-block] Acquired ${block.name} (offset=${block.offset}, lock=${port})`
      );
      break;
    }
  }

  if (!acquired) {
    console.error(
      `[port-block] All ${config.blocks.length} blocks are currently held`
    );
    process.exit(75); // EX_TEMPFAIL — workqueue may retry
  }

  const { block } = acquired;
  const runtimeConfigName = `firebase.runtime.${block.name}.json`;
  const runtimeConfigPath = resolve(projectRoot, runtimeConfigName);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      acquired?.release();
    } catch {
      /* ignore */
    }
    try {
      if (existsSync(runtimeConfigPath)) unlinkSync(runtimeConfigPath);
    } catch {
      /* ignore */
    }
  };

  // Generate the offset firebase config from firebase.e2e.json
  if (!existsSync(baseE2eConfigPath)) {
    console.error(`[port-block] Missing base config: ${baseE2eConfigPath}`);
    cleanup();
    process.exit(78);
  }
  applyOffsetToFirebaseConfig(
    baseE2eConfigPath,
    runtimeConfigPath,
    block.offset
  );

  const killPorts = shiftedKillPorts(baseE2eConfigPath, block.offset);

  // Build env for the child. Defaults match firebase.e2e.json + offset.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT_BLOCK: block.name,
    PORT_OFFSET: String(block.offset),
    FIREBASE_E2E_CONFIG: runtimeConfigName,
    EMULATOR_KILL_PORTS: killPorts.join(","),
    // Per-emulator ports, derived from firebase.e2e.json + offset
    EMULATOR_AUTH_PORT: String(9199 + block.offset),
    EMULATOR_FIRESTORE_PORT: String(8180 + block.offset),
    EMULATOR_FUNCTIONS_PORT: String(5101 + block.offset),
    EMULATOR_STORAGE_PORT: String(9299 + block.offset),
    // Vite reads VITE_EMULATOR_*_PORT for connectXEmulator()
    VITE_EMULATOR_AUTH_PORT: String(9199 + block.offset),
    VITE_EMULATOR_FIRESTORE_PORT: String(8180 + block.offset),
    VITE_EMULATOR_FUNCTIONS_PORT: String(5101 + block.offset),
    VITE_EMULATOR_STORAGE_PORT: String(9299 + block.offset),
  };

  console.error(
    `[port-block] Generated ${runtimeConfigName} (firestore=${
      8180 + block.offset
    }, auth=${9199 + block.offset}, functions=${5101 + block.offset}, storage=${
      9299 + block.offset
    })`
  );
  console.error(`[port-block] Running: ${cmd} ${cmdArgs.join(" ")}`);

  const child = spawn(cmd, cmdArgs, {
    stdio: "inherit",
    env: childEnv,
  });

  // Forward signals to the child so Ctrl+C / SIGTERM reach the test runner.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      if (!child.killed) child.kill(sig);
    });
  }

  child.on("exit", (code, signal) => {
    cleanup();
    if (signal) {
      // Re-raise the same signal so callers see the right exit reason
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });

  child.on("error", (err) => {
    console.error(`[port-block] Failed to spawn child: ${err.message}`);
    cleanup();
    process.exit(127);
  });

  // The lock-socket reference keeps Node alive while the child runs even
  // though we called server.unref() — spawn keeps its own ref. Belt and
  // suspenders: this loop just won't exit before the child does.
  await new Promise(() => {});
  // unreachable
  process.exit(0);
}

main().catch((err) => {
  console.error(`[port-block] Fatal: ${err}`);
  process.exit(70); // EX_SOFTWARE
});
