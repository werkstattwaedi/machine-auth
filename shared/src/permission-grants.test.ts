// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  grantedPermissionIds,
  heldPermissionIds,
  permissionGrantOf,
  type PermissionGrant,
} from "./permission-grants"

const ts = (ms: number) => ({ toMillis: () => ms })
const grant = (id: string, extra: Partial<PermissionGrant> = {}): PermissionGrant => ({
  permission: { id },
  grantedAt: ts(0),
  grantedBy: { id: "admin" },
  source: "admin",
  ...extra,
})

describe("heldPermissionIds", () => {
  it("holds a grant without windows for good", () => {
    expect(heldPermissionIds({ laser: grant("laser") }, 1_000)).toEqual(["laser"])
  })

  it("holds a temporary grant only inside a window, end exclusive", () => {
    const stored = {
      laser: grant("laser", {
        source: "course",
        windows: [
          { from: ts(100), until: ts(200) },
          { from: ts(500), until: ts(600) },
        ],
      }),
    }
    expect(heldPermissionIds(stored, 99)).toEqual([])
    expect(heldPermissionIds(stored, 100)).toEqual(["laser"])
    expect(heldPermissionIds(stored, 200)).toEqual([])
    expect(heldPermissionIds(stored, 550)).toEqual(["laser"])
    expect(heldPermissionIds(stored, 600)).toEqual([])
  })

  it("an empty window list holds never", () => {
    expect(heldPermissionIds({ laser: grant("laser", { windows: [] }) }, 1)).toEqual([])
  })

  it("reads the legacy list and nothing", () => {
    expect(heldPermissionIds([{ id: "laser" }, { id: "cnc" }], 0)).toEqual(["laser", "cnc"])
    expect(heldPermissionIds(undefined, 0)).toEqual([])
    expect(heldPermissionIds(null, 0)).toEqual([])
    expect(heldPermissionIds({}, 0)).toEqual([])
  })
})

describe("grantedPermissionIds", () => {
  it("lists temporary grants too", () => {
    const stored = {
      laser: grant("laser"),
      cnc: grant("cnc", { windows: [{ from: ts(0), until: ts(1) }] }),
    }
    expect(grantedPermissionIds(stored)).toEqual(["laser", "cnc"])
    expect(grantedPermissionIds([{ id: "laser" }])).toEqual(["laser"])
  })
})

describe("permissionGrantOf", () => {
  it("returns the grant, or a legacy grant for an unmigrated doc", () => {
    expect(permissionGrantOf({ laser: grant("laser") }, "laser")?.source).toBe("admin")
    expect(permissionGrantOf({ laser: grant("laser") }, "cnc")).toBeNull()
    expect(permissionGrantOf([{ id: "laser" }], "laser")).toEqual({
      permission: { id: "laser" },
      grantedAt: null,
      grantedBy: null,
      source: "legacy",
    })
  })
})
