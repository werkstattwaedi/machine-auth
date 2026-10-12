// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { readBuildVersion } from "./build_info";

describe("readBuildVersion", () => {
  const dir = mkdtempSync(join(tmpdir(), "build-info-"));

  it("reads the version deploy-functions.ts wrote", () => {
    const path = join(dir, "ok.json");
    writeFileSync(path, JSON.stringify({ version: "2026.10.3" }));
    expect(readBuildVersion(path)).to.equal("2026.10.3");
  });

  it("says dev when there is no deploy (emulator, tests)", () => {
    expect(readBuildVersion(join(dir, "missing.json"))).to.equal("dev");
  });

  it("says dev for a malformed file instead of failing the ping", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "{not json");
    expect(readBuildVersion(path)).to.equal("dev");
    writeFileSync(path, JSON.stringify({ version: 3 }));
    expect(readBuildVersion(path)).to.equal("dev");
  });
});
