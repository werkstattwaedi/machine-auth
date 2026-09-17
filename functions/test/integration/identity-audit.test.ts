// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Identity consistency audit (ADR-0043): one seeded record per finding
// class → the exact findings, then `fix` → only the report-only classes are
// left. Also pins what the audit must NOT report (doc-less-by-design
// principals, an intact managed member).

import { expect } from "chai";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  REPORT_ONLY_KINDS,
  runIdentityAudit,
  type IdentityFinding,
} from "../../src/auth/identity-audit";

async function seedDoc(
  uid: string,
  fields: Record<string, unknown>
): Promise<void> {
  await getFirestore()
    .collection("users")
    .doc(uid)
    .set({
      created: Timestamp.now(),
      firstName: "First",
      lastName: uid,
      roles: [],
      permissions: [],
      ...fields,
    });
}

/** A healthy member: doc + Auth agree, claims as syncCustomClaims leaves them. */
async function seedHealthy(uid: string, email: string, phone?: string) {
  await seedDoc(uid, { email, phone: phone ?? null });
  await getAuth().createUser({ uid, email, phoneNumber: phone });
  await getAuth().setCustomUserClaims(uid, { admin: false });
}

function kindsByUid(findings: IdentityFinding[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of findings) (out[f.uid] ??= []).push(f.kind);
  for (const kinds of Object.values(out)) kinds.sort();
  return out;
}

describe("runIdentityAudit (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    const auth = getAuth();
    const users = await auth.listUsers();
    await Promise.all(users.users.map((u) => auth.deleteUser(u.uid)));
  });

  const audit = (fix = false) =>
    runIdentityAudit({ auth: getAuth(), db: getFirestore() }, { fix });

  it("reports nothing for healthy members and doc-less-by-design principals", async () => {
    await seedHealthy("healthy", "healthy@example.com", "+41790000001");
    // Managed member, intact: e-mail-less doc + disabled, e-mail-less record.
    await seedDoc("managed", { email: null });
    await getAuth().createUser({ uid: "managed", disabled: true });
    // Doc-less by design.
    await getAuth().createUser({ uid: "tag:healthy:abc" });
    await getAuth().createUser({ uid: "anon-session" });
    await getAuth().createUser({ uid: "privacy-cli" });

    const outcome = await audit();

    expect(outcome.findings).to.deep.equal([]);
    expect(outcome.scanned).to.deep.equal({ usersDocs: 2, authRecords: 5 });
    expect(outcome.residual).to.equal(undefined);
  });

  it("classifies every kind of drift — findings carry uids only", async function () {
    this.timeout(20000);
    await seedDoc("no-auth", { email: "no-auth@example.com" });
    await seedDoc("managed-no-auth", { email: null });

    await seedDoc("drifted", { email: "drifted-new@example.com" });
    await getAuth().createUser({ uid: "drifted", email: "drifted-old@example.com" });

    await seedDoc("unpromoted", { email: "unpromoted@example.com" });
    await getAuth().createUser({ uid: "unpromoted", disabled: true });

    await seedDoc("auth-only-email", { email: null });
    await getAuth().createUser({ uid: "auth-only-email", email: "auth-only@example.com" });

    await seedDoc("shouty", { email: "Shouty@Example.COM" });
    await getAuth().createUser({ uid: "shouty", email: "shouty@example.com" });

    await seedHealthy("dup-a", "dup@example.com");
    await seedDoc("dup-b", { email: "dup@example.com" });
    await getAuth().createUser({ uid: "dup-b", email: "dup-b-auth@example.com" });

    await seedDoc("squatted", { email: "squatted@example.com" });
    await getAuth().createUser({ uid: "squatted", email: "squatted-old@example.com" });
    await getAuth().createUser({ uid: "squatter", email: "squatted@example.com" });

    await seedDoc("blocked-by-google", { email: "taken@example.com" });
    await getAuth().createUser({ uid: "blocked-by-google", email: "taken-old@example.com" });
    await getAuth().createUser({
      uid: "google-orphan",
      email: "taken@example.com",
      password: "hunter2-hunter2",
    });

    await seedHealthy("phone-drift", "phone-drift@example.com", "+41790000002");
    await getFirestore().collection("users").doc("phone-drift").update({ phone: "+41790000003" });

    await seedDoc("manual-block", { email: "manual-block@example.com" });
    await getAuth().createUser({
      uid: "manual-block",
      email: "manual-block@example.com",
      disabled: true,
    });

    await getAuth().createUser({ uid: "erasing", email: "erasing@example.com" });
    await getFirestore().collection("erasures").doc("erasing").set({ phase: "auth" });

    const outcome = await audit();

    expect(kindsByUid(outcome.findings)).to.deep.equal({
      "no-auth": ["doc-without-auth"],
      "managed-no-auth": ["doc-without-auth"],
      drifted: ["email-mismatch"],
      unpromoted: ["disabled-with-email", "email-mismatch"],
      "auth-only-email": ["email-mismatch"],
      shouty: ["email-not-normalized"],
      "dup-a": ["duplicate-email"],
      "dup-b": ["email-conflict"],
      squatted: ["email-conflict"],
      squatter: ["bare-auth"],
      "blocked-by-google": ["email-conflict"],
      "google-orphan": ["auth-without-doc"],
      "phone-drift": ["phone-mismatch"],
      "manual-block": ["disabled-with-email"],
      erasing: ["erasure-in-progress"],
    });
    expect(outcome.actions).to.deep.equal([]);
    // PII-free: no e-mail address or phone number anywhere in the outcome.
    const json = JSON.stringify(outcome);
    expect(json).to.not.match(/@example\.com/i);
    expect(json).to.not.match(/\+4179/);
  });

  it("fix heals the mechanical classes and leaves only report-only ones", async function () {
    this.timeout(20000);
    await seedDoc("no-auth", { email: "no-auth@example.com", roles: ["admin"] });
    await seedDoc("managed-no-auth", { email: null });
    await seedDoc("drifted", { email: "drifted-new@example.com" });
    await getAuth().createUser({ uid: "drifted", email: "drifted-old@example.com" });
    await seedDoc("unpromoted", { email: "unpromoted@example.com" });
    await getAuth().createUser({ uid: "unpromoted", disabled: true });
    await seedDoc("shouty", { email: "Shouty@Example.COM" });
    await getAuth().createUser({ uid: "shouty", email: "shouty@example.com" });
    await seedDoc("squatted", { email: "squatted@example.com" });
    await getAuth().createUser({ uid: "squatted", email: "squatted-old@example.com" });
    await getAuth().createUser({ uid: "squatter", email: "squatted@example.com" });
    await seedHealthy("phone-drift", "phone-drift@example.com", "+41790000002");
    await getFirestore().collection("users").doc("phone-drift").update({ phone: null });
    // Report-only:
    await seedDoc("manual-block", { email: "manual-block@example.com" });
    await getAuth().createUser({
      uid: "manual-block",
      email: "manual-block@example.com",
      disabled: true,
    });
    await seedDoc("blocked-by-google", { email: "taken@example.com" });
    await getAuth().createUser({ uid: "blocked-by-google", email: "taken-old@example.com" });
    await getAuth().createUser({
      uid: "google-orphan",
      email: "taken@example.com",
      password: "hunter2-hunter2",
    });

    const outcome = await audit(true);

    const auth = getAuth();
    const recreated = await auth.getUser("no-auth");
    expect(recreated.email).to.equal("no-auth@example.com");
    expect(recreated.customClaims).to.deep.equal({ admin: true });

    const managed = await auth.getUser("managed-no-auth");
    expect(managed.email).to.equal(undefined);
    expect(managed.disabled).to.equal(true);

    expect((await auth.getUser("drifted")).email).to.equal("drifted-new@example.com");

    const promoted = await auth.getUser("unpromoted");
    expect(promoted.email).to.equal("unpromoted@example.com");
    expect(promoted.disabled).to.equal(false);

    const shouty = await getFirestore().collection("users").doc("shouty").get();
    expect(shouty.get("email")).to.equal("shouty@example.com");

    expect((await auth.getUser("squatted")).email).to.equal("squatted@example.com");
    expect(
      await auth.getUser("squatter").then(() => "still there", () => "deleted")
    ).to.equal("deleted");

    expect((await auth.getUser("phone-drift")).phoneNumber).to.equal(undefined);

    // Never touched: a manual block stays blocked, a non-bare holder stays.
    expect((await auth.getUser("manual-block")).disabled).to.equal(true);
    expect((await auth.getUser("google-orphan")).email).to.equal("taken@example.com");

    expect(kindsByUid(outcome.residual!)).to.deep.equal({
      "manual-block": ["disabled-with-email"],
      "blocked-by-google": ["email-conflict"],
      "google-orphan": ["auth-without-doc"],
    });
    expect(outcome.actions.length).to.be.greaterThan(0);
    // Everything still open after a fix is either report-only or a conflict
    // fix could not resolve.
    for (const f of outcome.residual!) {
      expect(REPORT_ONLY_KINDS.has(f.kind) || f.kind === "email-conflict").to.equal(true);
    }
  });

  it("never normalizes an e-mail into a duplicate", async () => {
    await seedHealthy("lower", "same@example.com");
    await seedDoc("upper", { email: "Same@Example.com" });
    await getAuth().createUser({ uid: "upper", email: "upper-auth@example.com" });

    const outcome = await audit(true);

    const upper = await getFirestore().collection("users").doc("upper").get();
    expect(upper.get("email")).to.equal("Same@Example.com");
    expect(kindsByUid(outcome.residual!)["lower"]).to.include("duplicate-email");
  });
});
