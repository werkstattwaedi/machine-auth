// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Publishes workqueue review screenshots so they render inline in issue and
// PR comments. GitHub has no API for the comment-attachment upload humans
// use, so the images go into one commit on the orphan branch
// `workqueue-media` (never merged, never part of a PR diff) and are linked
// via raw.githubusercontent.com, pinned to that commit. The repo is public:
// only ever upload emulator captures, never staging or production screens.
//
// Usage:
//   npx tsx scripts/wq-media.ts <issue> <capture-dir> [--title "…"]
//
// <capture-dir> holds `before/<project>/<name>.png` and/or
// `after/<project>/<name>.png` (scripts/wq-capture.sh output). Prints a
// markdown block (before/after table per viewport) on stdout.

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO = "werkstattwaedi/machine-auth"
const BRANCH = "workqueue-media"
const API = "https://api.github.com"

export type Phase = "before" | "after"

/** One captured image: `<phase>/<project>/<name>.png` below the capture dir. */
export interface Capture {
  phase: Phase
  project: string
  name: string
  /** Path relative to the capture dir, with forward slashes. */
  rel: string
}

const PROJECT_LABELS: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobil",
}

/** Lists the PNGs of a capture dir; ignores anything not in the layout. */
export function listCaptures(dir: string): Capture[] {
  const out: Capture[] = []
  for (const phase of ["before", "after"] as const) {
    const phaseDir = path.join(dir, phase)
    if (!existsSync(phaseDir)) continue
    for (const project of readdirSync(phaseDir)) {
      const projectDir = path.join(phaseDir, project)
      if (!statSync(projectDir).isDirectory()) continue
      for (const file of readdirSync(projectDir)) {
        if (!file.endsWith(".png")) continue
        out.push({
          phase,
          project,
          name: file.slice(0, -".png".length),
          rel: `${phase}/${project}/${file}`,
        })
      }
    }
  }
  return out
}

/**
 * Renders a before/after table per viewport. `urlFor` maps a capture's
 * `rel` path to its published URL. Screens that only exist after the change
 * (new UI) get "—" in the before column, and vice versa.
 */
export function renderMarkdown(
  captures: Capture[],
  urlFor: (rel: string) => string,
  title = "Screenshots",
): string {
  const projects = [...new Set(captures.map((c) => c.project))].sort((a, b) =>
    projectOrder(a) - projectOrder(b) || a.localeCompare(b),
  )
  const width = (project: string) => (project === "mobile" ? 260 : 480)
  const lines = [`<!-- claude-workqueue-media -->`, `### ${title}`, ""]
  for (const project of projects) {
    const inProject = captures.filter((c) => c.project === project)
    const names = [...new Set(inProject.map((c) => c.name))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )
    const hasBefore = inProject.some((c) => c.phase === "before")
    const hasAfter = inProject.some((c) => c.phase === "after")
    const cell = (phase: Phase, name: string) => {
      const c = inProject.find((x) => x.phase === phase && x.name === name)
      return c ? `<img src="${urlFor(c.rel)}" width="${width(project)}">` : "—"
    }
    lines.push(`**${PROJECT_LABELS[project] ?? project}**`, "")
    const header = ["Screen", ...(hasBefore ? ["Vorher"] : []), ...(hasAfter ? ["Nachher"] : [])]
    lines.push(`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`)
    for (const name of names) {
      const row = [
        `\`${name}\``,
        ...(hasBefore ? [cell("before", name)] : []),
        ...(hasAfter ? [cell("after", name)] : []),
      ]
      lines.push(`| ${row.join(" | ")} |`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

function projectOrder(project: string): number {
  const order = Object.keys(PROJECT_LABELS).indexOf(project)
  return order === -1 ? Number.MAX_SAFE_INTEGER : order
}

// --- GitHub upload (git data API: blobs → tree → one commit) ---

async function gh<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as T
}

async function branchHead(token: string): Promise<string | null> {
  const res = await fetch(`${API}/repos/${REPO}/git/ref/heads/${BRANCH}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GET ref ${BRANCH} → ${res.status}: ${await res.text()}`)
  return ((await res.json()) as { object: { sha: string } }).object.sha
}

/** Uploads `files` (repo path → local file) as one commit; returns its sha. */
async function publish(
  token: string,
  files: Array<{ repoPath: string; local: string }>,
  message: string,
): Promise<string> {
  const parent = await branchHead(token)
  const baseTree = parent
    ? (await gh<{ tree: { sha: string } }>(token, "GET", `/repos/${REPO}/git/commits/${parent}`))
        .tree.sha
    : undefined

  const tree: Array<{ path: string; mode: string; type: string; sha: string }> = []
  for (const f of files) {
    const blob = await gh<{ sha: string }>(token, "POST", `/repos/${REPO}/git/blobs`, {
      content: readFileSync(f.local).toString("base64"),
      encoding: "base64",
    })
    tree.push({ path: f.repoPath, mode: "100644", type: "blob", sha: blob.sha })
  }
  if (!parent) {
    tree.push({
      path: "README.md",
      mode: "100644",
      type: "blob",
      sha: (
        await gh<{ sha: string }>(token, "POST", `/repos/${REPO}/git/blobs`, {
          content:
            "Review screenshots posted by /workqueue (scripts/wq-media.ts). " +
            "Orphan branch: never merge, safe to prune old folders.\n",
          encoding: "utf-8",
        })
      ).sha,
    })
  }

  const newTree = await gh<{ sha: string }>(token, "POST", `/repos/${REPO}/git/trees`, {
    ...(baseTree ? { base_tree: baseTree } : {}),
    tree,
  })
  const commit = await gh<{ sha: string }>(token, "POST", `/repos/${REPO}/git/commits`, {
    message,
    tree: newTree.sha,
    parents: parent ? [parent] : [],
  })
  if (parent) {
    await gh(token, "PATCH", `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha })
  } else {
    await gh(token, "POST", `/repos/${REPO}/git/refs`, {
      ref: `refs/heads/${BRANCH}`,
      sha: commit.sha,
    })
  }
  return commit.sha
}

function workqueueToken(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  return execFileSync(path.join(root, ".claude/scripts/workqueue-gh-token.sh"), {
    encoding: "utf-8",
  }).trim()
}

async function main(argv: string[]): Promise<void> {
  const titleIdx = argv.indexOf("--title")
  const title = titleIdx >= 0 ? argv[titleIdx + 1] : undefined
  const [issue, dir] = argv.filter((_, i) => i !== titleIdx && i !== titleIdx + 1)
  if (!issue || !/^\d+$/.test(issue) || !dir) {
    console.error('usage: wq-media.ts <issue> <capture-dir> [--title "…"]')
    process.exit(2)
  }
  const captures = listCaptures(dir)
  if (captures.length === 0) {
    console.error(`no captures under ${dir} (expected before|after/<project>/<name>.png)`)
    process.exit(1)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const prefix = `issue-${issue}/${stamp}`
  const sha = await publish(
    workqueueToken(),
    captures.map((c) => ({ repoPath: `${prefix}/${c.rel}`, local: path.join(dir, c.rel) })),
    `media: issue #${issue} review captures`,
  )
  const url = (rel: string) => `https://raw.githubusercontent.com/${REPO}/${sha}/${prefix}/${rel}`
  console.log(renderMarkdown(captures, url, title))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
