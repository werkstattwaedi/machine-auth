// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { latestRelease, parseBuildVersion, versionStanding } from "./release-version"

describe("parseBuildVersion", () => {
  it("reads releases, dev builds and dirty builds", () => {
    expect(parseBuildVersion("2026.10.3")).toEqual({ release: [2026, 10, 3], dev: null, dirty: false })
    expect(parseBuildVersion("2026.10.3-dev.4+g1a2b3c4d")).toEqual({
      release: [2026, 10, 3],
      dev: 4,
      dirty: false,
    })
    expect(parseBuildVersion("2026.10.3-dev.0+g1a2b3c4d.dirty")?.dirty).toBe(true)
    expect(parseBuildVersion("0.0.0-dev+g1a2b3c4d")).toEqual({ release: [0, 0, 0], dev: 0, dirty: false })
  })

  it("returns null for what is not a build version", () => {
    for (const v of ["dev", "", null, undefined, "1.0", "2026.10.3 beta"]) {
      expect(parseBuildVersion(v)).toBeNull()
    }
  })
})

describe("latestRelease", () => {
  it("picks the newest clean release, numerically", () => {
    expect(latestRelease(["2026.10.9", "2026.10.10", "2026.9.30", null])).toBe("2026.10.10")
  })

  it("ignores dev builds, dirty builds and pre-release placeholders", () => {
    expect(latestRelease(["2026.11.1-dev.2+gabc", "0.0.0-dev+gabc", "dev", "2026.10.3"])).toBe("2026.10.3")
    expect(latestRelease(["dev", null])).toBeNull()
  })
})

describe("versionStanding", () => {
  it("compares against the latest release", () => {
    expect(versionStanding("2026.10.3", "2026.10.3")).toBe("current")
    expect(versionStanding("2026.10.2", "2026.10.3")).toBe("behind")
    expect(versionStanding("2026.10.2-dev.5+gabc", "2026.10.3")).toBe("behind")
    expect(versionStanding("2026.10.3-dev.1+gabc", "2026.10.3")).toBe("dev")
    expect(versionStanding("2026.10.3", null)).toBe("current")
  })

  it("can't judge what it can't read", () => {
    expect(versionStanding(null, "2026.10.3")).toBe("unknown")
    expect(versionStanding("dev", "2026.10.3")).toBe("unknown")
  })
})
