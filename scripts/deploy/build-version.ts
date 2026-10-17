// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The one version every component reports (ADR-0045, phase 2a).
 *
 * Releases are named `YYYY.M.N` — the Nth release in that month — and
 * tagged `vYYYY.M.N` on a machine-auth commit by scripts/deploy/release.ts at the
 * commit's first deploy. A build derives its version from the nearest
 * release tag:
 *
 *   exactly a release tag, clean   2026.10.2
 *   later commit                   2026.10.2-dev.7+g1a2b3c4d
 *   uncommitted changes            2026.10.2-dev.7+g1a2b3c4d.dirty
 *   no release tag yet             0.0.0-dev+g1a2b3c4d
 *
 * All valid semver (electron-builder and npm require it). `BUILD_VERSION`
 * in the environment wins: the deploy scripts export it once, so every
 * build in one deploy — functions, both web apps, the kiosk — carries the
 * same string even if the tree changes underneath.
 *
 * Dirtiness ignores submodules (like deploy-record.ts): a locally moved
 * third_party/pigweed doesn't change the web or functions build, and the
 * gateway/firmware preflight refuses it anyway.
 *
 * Usage:
 *   npx tsx scripts/deploy/build-version.ts          # prints the version
 *
 * Imported by the web apps' vite.config.ts (viteBuildVersion), so it must
 * type-check under their strict tsconfig.node.json as well.
 */

import { execFileSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const RELEASE_TAG_RE = /^v(\d{4})\.(\d{1,2})\.(\d+)$/;

/** Tags in describe output are matched with this glob. */
export const RELEASE_TAG_GLOB = "v[0-9][0-9][0-9][0-9].*";

export interface ParsedRelease {
  year: number;
  month: number;
  n: number;
}

export function parseReleaseTag(tag: string): ParsedRelease | null {
  const m = tag.match(RELEASE_TAG_RE);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), n: Number(m[3]) };
}

/** Newest first. */
export function compareReleaseTags(a: string, b: string): number {
  const pa = parseReleaseTag(a);
  const pb = parseReleaseTag(b);
  if (!pa || !pb) return 0;
  return pb.year - pa.year || pb.month - pa.month || pb.n - pa.n;
}

/** Year and month of `now` on a Zurich wall clock. */
function zurichYearMonth(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month") };
}

/** The next release tag for `now`, given every tag in the repo. */
export function nextReleaseTag(tags: readonly string[], now: Date): string {
  const { year, month } = zurichYearMonth(now);
  let n = 0;
  for (const tag of tags) {
    const p = parseReleaseTag(tag);
    if (p && p.year === year && p.month === month) n = Math.max(n, p.n);
  }
  return `v${year}.${month}.${n + 1}`;
}

/**
 * Version from `git describe --long` output (`v2026.10.2-7-g1a2b3c4d`) or,
 * without any release tag, from the bare commit hash.
 */
export function versionFromDescribe(describe: string | null, sha: string, dirty: boolean): string {
  const m = describe?.match(/^v(\d{4}\.\d{1,2}\.\d+)-(\d+)-g([0-9a-f]+)$/);
  const meta = dirty ? ".dirty" : "";
  if (!m) return `0.0.0-dev+g${sha}${meta}`;
  const [, release, count, describedSha] = m;
  if (count === "0" && !dirty) return release;
  return `${release}-dev.${count}+g${describedSha}${meta}`;
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    }).trim();
  } catch {
    return null;
  }
}

/** The version of the checkout at `cwd` (or `BUILD_VERSION`). */
export function buildVersion(cwd: string = projectRoot): string {
  const fromEnv = process.env.BUILD_VERSION;
  if (fromEnv) return fromEnv;
  const sha = git(["rev-parse", "--short=8", "HEAD"], cwd);
  // No git (e.g. a source tarball): say so rather than invent a version.
  if (!sha) return "0.0.0-unknown";
  const status = git(["status", "--porcelain", "--untracked-files=no", "--ignore-submodules"], cwd);
  const dirty = status !== null && status.length > 0;
  // A commit can carry several releases (`release.ts --new-release`);
  // describe may pick any of them, the newest is the one that was cut last.
  const exact = (git(["tag", "--points-at", "HEAD", "--list", RELEASE_TAG_GLOB], cwd) ?? "")
    .split("\n")
    .filter((t) => parseReleaseTag(t))
    .sort(compareReleaseTags);
  if (exact.length > 0 && !dirty) return exact[0].slice(1);
  const describe = git(
    ["describe", "--tags", "--long", "--abbrev=8", "--match", RELEASE_TAG_GLOB, "HEAD"],
    cwd
  );
  return versionFromDescribe(describe, sha, dirty);
}

interface EmitFileContext {
  emitFile(file: { type: "asset"; fileName: string; source: string }): string;
}

/**
 * Vite plugin for the web apps: compiles the version in as
 * `import.meta.env.VITE_BUILD_VERSION` and emits `/version.json`, so a
 * deployed site can be asked what it is without loading the app.
 *
 * Builds only: the dev server (and the e2e suite running on it) says
 * "dev", so screenshot baselines don't change with every commit.
 * Structurally typed so this file doesn't depend on vite.
 */
export function viteBuildVersion() {
  let version = "dev";
  return {
    name: "oww-build-version",
    apply: "build" as const,
    config() {
      version = buildVersion();
      return { define: { "import.meta.env.VITE_BUILD_VERSION": JSON.stringify(version) } };
    },
    generateBundle(this: EmitFileContext) {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version }) + "\n",
      });
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(buildVersion());
}
