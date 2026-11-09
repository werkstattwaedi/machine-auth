// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Permission grants (#843): admin grant/revoke through the callables, and
// the machine check-in reading the grant map (windows, legacy list).

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
  seedTestData,
} from "../emulator-helper";
import {
  grantPermissionHandler,
  revokePermissionHandler,
} from "../../src/auth/permission-grants";
import { handleTerminalCheckin } from "../../src/auth/handle_terminal_checkin";

const USER = "member-1";
const ADMIN = "admin-1";
const TOKEN = "04c339aa1e1890";
const MACHINE = "laser-1";

function request(data: unknown, admin = true, uid = ADMIN): CallableRequest<unknown> {
  return { data, auth: { uid, token: { admin } } } as unknown as CallableRequest<unknown>;
}

async function expectHttpsError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    expect(err?.code, err?.message).to.equal(code);
    return;
  }
  expect.fail(`expected ${code}`);
}

async function permissionsOf(uid: string): Promise<Record<string, any>> {
  return (await getFirestore().collection("users").doc(uid).get()).get("permissions");
}

describe("permission grants (#843)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });
  after(async () => teardownEmulator());

  beforeEach(async () => {
    await clearFirestore();
    await seedTestData({
      permissions: { laser: { name: "Laser" }, cnc: { name: "CNC" } },
      users: {
        [USER]: { firstName: "Mia", lastName: "Member", roles: [], permissions: [] },
        [ADMIN]: { firstName: "Ada", lastName: "Admin", roles: ["admin"], permissions: [] },
      },
      tokens: { [TOKEN]: { userId: `/users/${USER}`, label: "Badge" } },
      machines: { [MACHINE]: { name: "Laser", requiredPermission: ["/permission/laser"] } },
    });
  });

  describe("grantPermission / revokePermission", () => {
    it("records who granted it and when", async () => {
      const result = await grantPermissionHandler(request({ userId: USER, permissionId: "laser" }));
      expect(result).to.deep.equal({ changed: true });
      const grant = (await permissionsOf(USER)).laser;
      expect(grant.source).to.equal("admin");
      expect(grant.grantedBy.path).to.equal(`users/${ADMIN}`);
      expect(grant.permission.path).to.equal("permission/laser");
      expect(grant.grantedAt).to.be.instanceOf(Timestamp);
    });

    it("lets an admin grant to themselves", async () => {
      await grantPermissionHandler(request({ userId: ADMIN, permissionId: "laser" }));
      expect(Object.keys(await permissionsOf(ADMIN))).to.deep.equal(["laser"]);
    });

    it("leaves a grant for good alone, but makes a temporary one permanent", async () => {
      await grantPermissionHandler(request({ userId: USER, permissionId: "laser" }));
      const first = (await permissionsOf(USER)).laser.grantedAt;
      expect(
        await grantPermissionHandler(request({ userId: USER, permissionId: "laser" }))
      ).to.deep.equal({ changed: false });
      expect((await permissionsOf(USER)).laser.grantedAt.isEqual(first)).to.equal(true);

      await getFirestore()
        .collection("users")
        .doc(USER)
        .update({
          "permissions.cnc": {
            permission: getFirestore().doc("permission/cnc"),
            grantedAt: null,
            grantedBy: null,
            source: "course",
            course: { offerId: "o1" },
            windows: [{ from: Timestamp.fromMillis(0), until: Timestamp.fromMillis(1) }],
          },
        });
      await grantPermissionHandler(request({ userId: USER, permissionId: "cnc" }));
      const cnc = (await permissionsOf(USER)).cnc;
      expect(cnc.source).to.equal("admin");
      expect(cnc.windows).to.equal(undefined);
    });

    it("turns a legacy list into the map on the first change", async () => {
      await getFirestore()
        .collection("users")
        .doc(USER)
        .update({ permissions: [getFirestore().doc("permission/cnc")] });
      await grantPermissionHandler(request({ userId: USER, permissionId: "laser" }));
      const map = await permissionsOf(USER);
      expect(map.cnc.source).to.equal("legacy");
      expect(map.laser.source).to.equal("admin");
    });

    it("removes a grant", async () => {
      await grantPermissionHandler(request({ userId: USER, permissionId: "laser" }));
      expect(
        await revokePermissionHandler(request({ userId: USER, permissionId: "laser" }))
      ).to.deep.equal({ changed: true });
      expect(await permissionsOf(USER)).to.deep.equal({});
      expect(
        await revokePermissionHandler(request({ userId: USER, permissionId: "laser" }))
      ).to.deep.equal({ changed: false });
    });

    it("refuses non-admins, unknown people and unknown permissions", async () => {
      await expectHttpsError(
        () => grantPermissionHandler(request({ userId: USER, permissionId: "laser" }, false, USER)),
        "permission-denied"
      );
      await expectHttpsError(
        () => revokePermissionHandler(request({ userId: USER, permissionId: "laser" }, false, USER)),
        "permission-denied"
      );
      await expectHttpsError(
        () => grantPermissionHandler(request({ userId: "nobody", permissionId: "laser" })),
        "not-found"
      );
      await expectHttpsError(
        () => grantPermissionHandler(request({ userId: USER, permissionId: "nope" })),
        "not-found"
      );
      await expectHttpsError(
        () => grantPermissionHandler(request({ userId: USER })),
        "invalid-argument"
      );
    });
  });

  describe("machine check-in", () => {
    const config = { masterKey: "000102030405060708090a0b0c0d0e0f", systemName: "OwwMachineAuth" };
    const checkin = () =>
      handleTerminalCheckin(
        {
          tokenId: { value: new Uint8Array(Buffer.from(TOKEN, "hex")) },
          machineId: { value: MACHINE },
        },
        config
      );
    const setLaser = (extra: Record<string, unknown>) =>
      getFirestore()
        .collection("users")
        .doc(USER)
        .update({
          "permissions.laser": {
            permission: getFirestore().doc("permission/laser"),
            grantedAt: null,
            grantedBy: null,
            source: "course",
            ...extra,
          },
        });

    it("unlocks inside a temporary grant's window only", async () => {
      const now = Date.now();
      await setLaser({
        windows: [{ from: Timestamp.fromMillis(now - 60_000), until: Timestamp.fromMillis(now + 60_000) }],
      });
      expect((await checkin()).result?.$case).to.equal("authorized");

      await setLaser({
        windows: [{ from: Timestamp.fromMillis(now - 120_000), until: Timestamp.fromMillis(now - 60_000) }],
      });
      expect((await checkin()).result?.$case).to.equal("rejected");
    });

    it("still unlocks for a doc that holds the legacy list", async () => {
      await getFirestore()
        .collection("users")
        .doc(USER)
        .update({ permissions: [getFirestore().doc("permission/laser")] });
      expect((await checkin()).result?.$case).to.equal("authorized");
    });
  });
});
