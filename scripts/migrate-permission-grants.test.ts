// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test } from "node:test";
import assert from "node:assert/strict";

import { lastGrantFromAudit, type UserAuditEntry } from "./migrate-permission-grants.ts";

const at = (ms: number) => ({ toMillis: () => ms });
const entry = (
  ms: number,
  before: string[] | null,
  after: string[] | null,
  actorUid: string | null = "admin1"
): UserAuditEntry => ({
  timestamp: at(ms),
  actorUid,
  before: before && { permissions: before },
  after: after && { permissions: after },
});

const LASER = "permission/laser";

test("finds the write that added the permission", () => {
  const log = [entry(1, [], []), entry(5, [], [LASER], "a"), entry(9, [LASER], [LASER, "permission/cnc"])];
  assert.deepEqual(lastGrantFromAudit(log, LASER), { atMs: 5, actorUid: "a" });
});

test("takes the last grant after a removal, in time order whatever the input order", () => {
  const log = [entry(30, [], [LASER], "b"), entry(10, [], [LASER], "a"), entry(20, [LASER], [], "a")];
  assert.deepEqual(lastGrantFromAudit(log, LASER), { atMs: 30, actorUid: "b" });
});

test("a doc created with the permission counts as its grant", () => {
  assert.deepEqual(lastGrantFromAudit([entry(3, null, [LASER], null)], LASER), {
    atMs: 3,
    actorUid: null,
  });
});

test("null when the log doesn't reach back", () => {
  assert.equal(lastGrantFromAudit([entry(3, [LASER], [LASER])], LASER), null);
  assert.equal(lastGrantFromAudit([], LASER), null);
});
