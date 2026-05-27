// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { init, parse } from "cjs-module-lexer"

// Regression guard for issue #339.
//
// `@oww/shared` is a CJS package (ADR-0027). When `shared/src/index.ts`
// re-exported the printer subtree as a *namespace*
// (`export * as printer from "./printer"`), the compiled CJS became
// `exports.printer = __importStar(require("./printer"))`. Vite's dev
// pre-bundler (optimizeDeps, enabled for the admin app via #326) relies
// on `cjs-module-lexer` to synthesize ESM named bindings from the CJS
// module. The lexer reports `export * as ns` as a *flat, opaque* export
// it cannot follow, so the synthesized `printer` binding resolved to
// `undefined` at dev runtime and `const { TAPE_SPECS } = printer` threw
// on admin module init — cascading into ~10 admin e2e failures.
//
// A plain `require()` or esbuild bundle resolves the namespace fine, so
// a naive runtime-require test would NOT catch this. This test reproduces
// exactly what Vite's optimizer does: it runs the built CJS through
// `cjs-module-lexer` and recursively follows reexports, asserting the
// printer symbols resolve as first-class named exports (i.e. `./printer`
// shows up as a *followable reexport*, not as opaque flat `exports`).
//
// RED on `export * as printer from "./printer"`; GREEN on
// `export * from "./printer"`.

const here = dirname(fileURLToPath(import.meta.url))
const sharedRoot = resolve(here, "..", "..")
const distEntry = join(sharedRoot, "dist", "index.js")

/**
 * Recursively resolve the named exports of a built CJS module by following
 * `cjs-module-lexer` reexports, mirroring how Vite's dep optimizer
 * synthesizes named ESM bindings. Returns the union of named exports
 * (minus the `__esModule` marker) reachable from `entryFile`.
 */
async function resolveNamedExports(entryFile: string): Promise<Set<string>> {
  await init()
  const collected = new Set<string>()
  const seen = new Set<string>()

  const visit = async (file: string): Promise<void> => {
    if (seen.has(file)) return
    seen.add(file)
    const src = await readFile(file, "utf8")
    const { exports, reexports } = parse(src)
    for (const name of exports) {
      if (name !== "__esModule") collected.add(name)
    }
    for (const spec of reexports) {
      // Only relative reexports point at sibling dist files we can follow.
      if (!spec.startsWith(".")) continue
      const base = resolve(dirname(file), spec)
      const candidate = existsSync(base) ? join(base, "index.js") : `${base}.js`
      if (existsSync(candidate)) await visit(candidate)
    }
  }

  await visit(entryFile)
  return collected
}

describe("@oww/shared built entry exports (issue #339)", () => {
  beforeAll(() => {
    // The lexer must read the compiled `dist/`, not the TS source. Build
    // if missing so the test is self-contained when run in isolation.
    if (!existsSync(distEntry)) {
      execFileSync("npm", ["run", "build"], { cwd: sharedRoot, stdio: "inherit" })
    }
  })

  it("exposes printer symbols as resolvable named exports", async () => {
    const names = await resolveNamedExports(distEntry)
    // These would all be unreachable (hidden behind an opaque `printer`
    // namespace binding) under the broken `export * as printer` form.
    for (const symbol of [
      "TAPE_SPECS",
      "buildRasterJob",
      "parseStatus",
      "packbits",
    ]) {
      expect(names, `expected "${symbol}" to be a named export of @oww/shared`).toContain(symbol)
    }
  })

  it("does not leak an opaque `printer` namespace binding", async () => {
    await init()
    const src = await readFile(distEntry, "utf8")
    const { exports, reexports } = parse(src)
    // The flat form lists `./printer` as a followable reexport; the broken
    // namespace form would instead list `printer` as a flat export here.
    expect(reexports).toContain("./printer")
    expect(exports).not.toContain("printer")
  })
})
