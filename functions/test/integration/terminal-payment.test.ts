// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview The Wallee terminal path (ADR-0051) against the Firestore
 * emulator: `prepareTerminalPayment` prices an attempt on the open
 * checkout, `settleTerminalPayment` closes it from Wallee's confirmation,
 * the webhook and the nightly reconcile feed it. Wallee itself is a fake
 * (`setWalleeApiForTest`); the shapes come from the A35 spike.
 */

// Params are read from process.env at .value() time outside a deploy.
process.env.FUNCTIONS_EMULATOR = "true";
process.env.PAYMENT_IBAN = process.env.PAYMENT_IBAN ?? "CH56 0000 0000 0000 0000 0";
process.env.PAYMENT_RECIPIENT_NAME = process.env.PAYMENT_RECIPIENT_NAME ?? "Test Recipient";
process.env.PAYMENT_RECIPIENT_STREET = process.env.PAYMENT_RECIPIENT_STREET ?? "Teststrasse 1";
process.env.PAYMENT_RECIPIENT_POSTAL_CODE = process.env.PAYMENT_RECIPIENT_POSTAL_CODE ?? "8820";
process.env.PAYMENT_RECIPIENT_CITY = process.env.PAYMENT_RECIPIENT_CITY ?? "Wädenswil";
process.env.PAYMENT_RECIPIENT_COUNTRY = process.env.PAYMENT_RECIPIENT_COUNTRY ?? "CH";
process.env.PAYMENT_CURRENCY = process.env.PAYMENT_CURRENCY ?? "CHF";
process.env.RAISENOW_PAYLINK_SOLUTION_ID = process.env.RAISENOW_PAYLINK_SOLUTION_ID ?? "test-solution";
// The terminal's own params are pinned per test (see TERMINAL_ENV): all
// integration files share one process, and others set these at import.
const TERMINAL_ENV: Record<string, string> = {
  PAYMENT_METHODS_KIOSK: "wallee_terminal,rechnung,monthly",
  PAYMENT_METHODS_WEB: "rechnung,monthly,raisenow",
  WALLEE_SPACE_ID: "100",
  WALLEE_USER_ID: "200",
  WALLEE_TERMINAL_ID: "300",
  WALLEE_REFERENCE_PREFIX: "P",
};
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT ?? "oww-maco";

import { expect } from "chai";
import * as sinon from "sinon";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  APPROVAL_REPORT_WINDOW_MS,
  UNCONFIRMED_GRACE_MS,
  UNCONFIRMED_REALERT_MS,
  alertUnconfirmedApprovals,
  prepareTerminalPaymentHandler,
  reportTerminalApprovalHandler,
  settleTerminalPayment,
  type PrepareTerminalPaymentResponse,
} from "../../src/invoice/terminal_payment";
import { closeCheckoutAndGetPaymentHandler } from "../../src/invoice/close_checkout_and_get_payment";
import { isCommittedAtClose } from "../../src/invoice/bill_triggers";
import {
  handleWalleeWebhook,
  handleWalleeWebhookSafely,
  runReconcileTerminalPayments,
} from "../../src/payments/wallee_webhook";
import * as walleeModule from "../../src/payments/wallee";
import {
  setWalleeApiForTest,
  walleeListenerName,
  type WalleeApi,
  type WalleeListener,
  type WalleeTransaction,
} from "../../src/payments/wallee";
import type {
  CheckoutEntity,
  CheckoutPersonEntity,
} from "../../src/types/firestore_entities";
import type { BillEntity } from "../../src/invoice/types";

const OWNER = "terminal-owner";
const RECEIPT = "*** Kundenbeleg ***\nXXXXXXXXXXXX0000\nTotal-EFT CHF: 25.00";

const ADULT: CheckoutPersonEntity = {
  name: "Alice Adult",
  email: "alice@example.com",
  userType: "erwachsen",
};

/** A Wallee double: transactions by id, a signature verdict, listeners. */
class FakeWallee implements WalleeApi {
  transactions = new Map<number, WalleeTransaction>();
  signatureValid = true;
  receiptFails = false;
  receiptCalls = 0;
  failReads = false;
  listeners: WalleeListener[] = [
    { id: 1, name: walleeListenerName(process.env.GCLOUD_PROJECT ?? ""), state: "ACTIVE" },
  ];

  async getTransaction(id: number): Promise<WalleeTransaction> {
    if (this.failReads) throw new Error("wallee unreachable");
    const t = this.transactions.get(id);
    if (!t) throw new Error(`no transaction ${id}`);
    return t;
  }
  async searchPaidTerminalTransactions(): Promise<WalleeTransaction[]> {
    return [...this.transactions.values()].filter((t) =>
      ["AUTHORIZED", "COMPLETED", "FULFILL"].includes(t.state),
    );
  }
  async getCustomerReceiptText(): Promise<string | null> {
    this.receiptCalls++;
    if (this.receiptFails) throw new Error("receipt unavailable");
    return RECEIPT;
  }
  async isSignatureValid(): Promise<boolean> {
    return this.signatureValid;
  }
  async listWebhookListeners(): Promise<WalleeListener[]> {
    return this.listeners;
  }

  pay(id: number, reference: string, amount: number, extra: Partial<WalleeTransaction> = {}) {
    this.transactions.set(id, {
      id,
      state: "AUTHORIZED",
      authorizationAmount: amount,
      currency: "CHF",
      authorizedOn: new Date("2026-10-16T07:39:04.865Z"),
      merchantReference: reference,
      userInterfaceType: "TERMINAL",
      terminalId: 300,
      paymentBrand: "Mastercard",
      ...extra,
    });
  }
}

let wallee: FakeWallee;

async function seedPricing(): Promise<void> {
  await getFirestore().doc("config/pricing").set({
    workshops: { holz: { label: "Holzwerkstatt", order: 1 } },
    entryFees: {
      erwachsen: { regular: 15 },
      kind: { regular: 7.5 },
      firma: { regular: 30 },
    },
  });
}

async function seedUser(uid: string): Promise<void> {
  await getFirestore().collection("users").doc(uid).set({
    created: Timestamp.now(),
    firstName: "Alice",
    lastName: "Adult",
    email: "alice@example.com",
    permissions: [],
    roles: [],
    userType: "erwachsen",
  });
}

/** An open checkout of OWNER with one CHF 10 item (total 25 with the fee). */
async function seedOpenCheckout(id: string, extra: Partial<CheckoutEntity> = {}): Promise<void> {
  const db = getFirestore();
  const now = Timestamp.now();
  await db.collection("checkouts").doc(id).set({
    userId: db.collection("users").doc(OWNER),
    status: "open",
    usageType: "regular",
    created: now,
    workshopsVisited: ["holz"],
    persons: [ADULT],
    modifiedBy: OWNER,
    modifiedAt: now,
    ...extra,
  });
  await db.collection("checkouts").doc(id).collection("items").doc("i0").set({
    workshop: "holz",
    description: "Brett",
    origin: "manual",
    catalogId: null,
    created: now,
    quantity: 1,
    unitPrice: 10,
    totalPrice: 10,
  });
}

function request<T>(data: T, uid: string | null = OWNER): CallableRequest<T> {
  return {
    data,
    auth: uid ? { uid, token: {} } : undefined,
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as CallableRequest<T>;
}

const wirePersons = [
  {
    name: ADULT.name,
    email: ADULT.email,
    userType: ADULT.userType,
    userId: OWNER,
    usageType: "regular",
  },
];

async function prepare(checkoutId: string, tip = 0): Promise<PrepareTerminalPaymentResponse> {
  return prepareTerminalPaymentHandler(
    request({
      checkoutId,
      persons: wirePersons,
      summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip },
    }) as never,
  );
}

async function report(checkoutId: string, attempt: number, uid: string | null = OWNER) {
  return reportTerminalApprovalHandler(request({ checkoutId, attempt }, uid) as never);
}

async function checkout(id: string): Promise<CheckoutEntity> {
  return (await getFirestore().collection("checkouts").doc(id).get()).data() as CheckoutEntity;
}

async function alertMarkers() {
  return (await getFirestore().collection("terminalPaymentAlerts").get()).docs;
}

async function bills(): Promise<{ id: string; data: BillEntity }[]> {
  const snap = await getFirestore().collection("bills").get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as BillEntity }));
}

async function expectRejects(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    expect((err as { code?: string }).code).to.equal(code);
    return;
  }
  expect.fail(`expected ${code}`);
}

describe("Wallee terminal payment (Integration)", () => {
  before(async function () {
    this.timeout(20000);
    await setupEmulator();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  after(async () => {
    setWalleeApiForTest(null);
    await teardownEmulator();
  });
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(async () => {
    for (const [k, v] of Object.entries(TERMINAL_ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
    await clearFirestore();
    await seedPricing();
    await seedUser(OWNER);
    wallee = new FakeWallee();
    setWalleeApiForTest(wallee);
  });

  describe("prepareTerminalPayment", () => {
    it("prices the attempt like the close and creates no bill", async () => {
      await seedOpenCheckout("co1");
      const res = await prepare("co1", 2.5);
      expect(res).to.include({
        checkoutId: "co1",
        attempt: 1,
        reference: "P-co1-1",
        amount: 27.5,
        amountRappen: 2750,
        payerEmail: "alice@example.com",
      });
      const co = await checkout("co1");
      expect(co.status).to.equal("open");
      expect(co.terminalAttemptCount).to.equal(1);
      const attempt = co.terminalAttempts?.["1"];
      expect(attempt?.amount).to.equal(27.5);
      expect(attempt?.summary.tip).to.equal(2.5);
      expect(attempt?.preparedBy).to.equal(OWNER);
      expect(attempt?.persons[0].userRef?.id).to.equal(OWNER);
      expect(await bills()).to.have.length(0);
    });

    it("hands out a fresh attempt each time and keeps the older ones", async () => {
      await seedOpenCheckout("co1");
      await prepare("co1");
      const second = await prepare("co1");
      expect(second.reference).to.equal("P-co1-2");
      const co = await checkout("co1");
      expect(Object.keys(co.terminalAttempts ?? {})).to.have.members(["1", "2"]);
    });

    it("refuses a stranger, a closed checkout and a free visit", async () => {
      await seedOpenCheckout("co1");
      await seedUser("someone-else");
      await expectRejects(
        prepareTerminalPaymentHandler(
          request({ checkoutId: "co1", persons: wirePersons }, "someone-else") as never,
        ),
        "permission-denied",
      );

      await seedOpenCheckout("closed", { status: "closed" });
      await expectRejects(prepare("closed"), "failed-precondition");

      await seedOpenCheckout("free");
      await getFirestore().collection("checkouts").doc("free").collection("items").doc("i0").delete();
      await expectRejects(
        prepareTerminalPaymentHandler(
          request({
            checkoutId: "free",
            persons: [{ ...wirePersons[0], usageType: "intern" }],
          }) as never,
        ),
        "failed-precondition",
      );
    });

    it("tells the kiosk when Wallee already closed the checkout", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      wallee.pay(9001, reference, 25);
      await settleTerminalPayment(9001, "webhook");
      try {
        await prepare("co1");
        expect.fail("expected a refusal");
      } catch (err) {
        const e = err as { code?: string; message?: string; details?: unknown };
        expect(e.code).to.equal("failed-precondition");
        expect(e.message).to.not.contain("co1");
        expect(e.details).to.deep.equal({
          reason: "checkout-closed",
          paidAtTerminal: true,
          amount: 25,
          payerEmail: "alice@example.com",
        });
      }
    });

    it("refuses an eleventh attempt", async () => {
      await seedOpenCheckout("co1");
      for (let i = 0; i < 10; i++) await prepare("co1");
      await expectRejects(prepare("co1"), "failed-precondition");
      expect((await checkout("co1")).terminalAttemptCount).to.equal(10);
    });

    it("refuses while the terminal is offered nowhere", async () => {
      await seedOpenCheckout("co1");
      const prev = process.env.PAYMENT_METHODS_KIOSK;
      process.env.PAYMENT_METHODS_KIOSK = "rechnung,monthly";
      try {
        await expectRejects(prepare("co1"), "failed-precondition");
      } finally {
        process.env.PAYMENT_METHODS_KIOSK = prev;
      }
    });
  });

  describe("reportTerminalApproval (#812)", () => {
    it("parks the checkout as awaiting payment, without a bill", async () => {
      await seedOpenCheckout("co1");
      const { attempt } = await prepare("co1");

      expect(await report("co1", attempt)).to.deep.equal({ status: "awaiting_payment" });

      const co = await checkout("co1");
      expect(co.status).to.equal("awaiting_payment");
      expect(co.terminalApproval?.attempt).to.equal(attempt);
      expect(co.terminalApproval?.reportedBy).to.equal(OWNER);
      expect(co.paymentMethod).to.equal(undefined);
      expect(co.billRef).to.equal(undefined);
      expect(co.closedAt).to.equal(undefined);
      expect(await bills()).to.have.length(0);
      // A retry changes nothing.
      expect(await report("co1", attempt)).to.deep.equal({ status: "awaiting_payment" });
    });

    it("counts a parked visit for the same-day usage fee", async () => {
      await seedOpenCheckout("co1");
      const first = await prepare("co1");
      expect(first.amount).to.equal(25);
      await report("co1", first.attempt);

      // The next visit that day pays the material only (CHK-37).
      await seedOpenCheckout("co2");
      expect((await prepare("co2")).amount).to.equal(10);
    });

    it("is a no-op when Wallee's confirmation came first", async () => {
      await seedOpenCheckout("co1");
      const { attempt, reference } = await prepare("co1");
      wallee.pay(9001, reference, 25);
      await settleTerminalPayment(9001, "webhook");
      expect(await report("co1", attempt)).to.deep.equal({ status: "closed" });
      expect((await checkout("co1")).terminalApproval).to.equal(undefined);
    });

    it("refuses a stranger, an earlier attempt and a late report", async () => {
      await seedOpenCheckout("co1");
      const first = await prepare("co1");
      await expectRejects(report("co1", first.attempt, "someone-else"), "permission-denied");
      const second = await prepare("co1");
      await expectRejects(report("co1", first.attempt), "failed-precondition");
      await expectRejects(report("co1", 99), "failed-precondition");

      const late = Timestamp.fromMillis(Date.now() - APPROVAL_REPORT_WINDOW_MS - 1000);
      await getFirestore().collection("checkouts").doc("co1").update({
        [`terminalAttempts.${second.attempt}.createdAt`]: late,
      });
      await expectRejects(report("co1", second.attempt), "failed-precondition");
      expect((await checkout("co1")).status).to.equal("open");
    });

    it("takes the report from a kiosk acting as the owner and from an anonymous visitor", async () => {
      await seedOpenCheckout("coKiosk");
      const { attempt } = await prepare("coKiosk");
      const kiosk = {
        data: { checkoutId: "coKiosk", attempt },
        auth: { uid: "tag:kiosk", token: { actsAs: OWNER } },
        rawRequest: {},
        acceptsStreaming: false,
      };
      expect(await reportTerminalApprovalHandler(kiosk as never)).to.deep.equal({
        status: "awaiting_payment",
      });
      expect((await checkout("coKiosk")).terminalApproval?.reportedBy).to.equal(OWNER);

      // An anonymous visitor's cart: only the session that opened it.
      await seedOpenCheckout("coAnon", { userId: null as never, modifiedBy: "anon-1" });
      await getFirestore().collection("checkouts").doc("coAnon").update({
        terminalAttemptCount: 1,
        "terminalAttempts.1": { reference: "P-coAnon-1", amount: 25, createdAt: Timestamp.now() },
      });
      const anon = (uid: string) => ({
        data: { checkoutId: "coAnon", attempt: 1 },
        auth: { uid, token: { firebase: { sign_in_provider: "anonymous" } } },
        rawRequest: {},
        acceptsStreaming: false,
      });
      await expectRejects(reportTerminalApprovalHandler(anon("anon-2") as never), "permission-denied");
      await expectRejects(report("coAnon", 1), "permission-denied");
      expect(await reportTerminalApprovalHandler(anon("anon-1") as never)).to.deep.equal({
        status: "awaiting_payment",
      });
    });

    it("refuses a checkout closed another way", async () => {
      await seedOpenCheckout("co1", { status: "closed" });
      await expectRejects(report("co1", 1), "failed-precondition");
    });

    it("shows a payment start on a parked checkout as paid", async () => {
      await seedOpenCheckout("co1");
      const { attempt } = await prepare("co1");
      await report("co1", attempt);
      try {
        await prepare("co1");
        expect.fail("expected a refusal");
      } catch (err) {
        const e = err as { code?: string; details?: unknown };
        expect(e.code).to.equal("failed-precondition");
        expect(e.details).to.deep.equal({
          reason: "checkout-closed",
          paidAtTerminal: true,
          amount: 25,
          payerEmail: "alice@example.com",
        });
      }
    });

    it("lets the close callable not close a parked checkout", async () => {
      await seedOpenCheckout("co1");
      const { attempt } = await prepare("co1");
      await report("co1", attempt);
      await expectRejects(
        closeCheckoutAndGetPaymentHandler(
          request({ checkoutId: "co1", persons: wirePersons, paymentMethod: "rechnung" }) as never,
        ),
        "failed-precondition",
      );
    });

    it("settles a parked checkout like an open one, also from an earlier attempt", async () => {
      await seedOpenCheckout("co1");
      const first = await prepare("co1");
      const second = await prepare("co1");
      await report("co1", second.attempt);
      wallee.pay(9001, first.reference, 25);
      expect(await settleTerminalPayment(9001, "webhook")).to.equal("settled");
      const co = await checkout("co1");
      expect(co.status).to.equal("closed");
      expect(co.terminalApproval).to.equal(undefined);
      expect(co.terminalAttempts).to.equal(undefined);
      // The approved attempt's own money is then a double charge.
      wallee.pay(9002, second.reference, 25);
      expect(await settleTerminalPayment(9002, "webhook")).to.equal("double-charge");
    });
  });

  describe("alertUnconfirmedApprovals (#812)", () => {
    async function park(id: string, reportedAgoMs: number) {
      await seedOpenCheckout(id);
      const { attempt } = await prepare(id);
      await report(id, attempt);
      await getFirestore().collection("checkouts").doc(id).update({
        "terminalApproval.reportedAt": Timestamp.fromMillis(Date.now() - reportedAgoMs),
      });
    }

    it("alerts after the grace period, once a week, and not once settled", async () => {
      await park("late", UNCONFIRMED_GRACE_MS + 60_000);
      await park("fresh", 60_000);

      expect(await alertUnconfirmedApprovals()).to.deep.equal(["late"]);
      expect((await checkout("late")).terminalApproval?.alertedAt).to.not.equal(null);
      expect(await alertUnconfirmedApprovals()).to.deep.equal([]);

      const nextWeek = new Date(Date.now() + UNCONFIRMED_REALERT_MS + 60_000);
      expect((await alertUnconfirmedApprovals(nextWeek)).sort()).to.deep.equal(["fresh", "late"]);

      const late = await checkout("late");
      wallee.pay(9001, late.terminalAttempts!["1"].reference, 25);
      await settleTerminalPayment(9001, "webhook");
      const later = new Date(nextWeek.getTime() + UNCONFIRMED_REALERT_MS + 60_000);
      expect(await alertUnconfirmedApprovals(later)).to.deep.equal(["fresh"]);
    });
  });

  describe("settleTerminalPayment", () => {
    it("closes the checkout with a paid, committed Quittung", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      wallee.pay(9001, reference, 25);

      expect(await settleTerminalPayment(9001, "webhook")).to.equal("settled");

      const co = await checkout("co1");
      expect(co.status).to.equal("closed");
      expect(co.paymentMethod).to.equal("wallee_terminal");
      expect(co.walleeTransactionId).to.equal(9001);
      expect(co.terminalAttempts).to.equal(undefined);
      expect(co.summary?.totalPrice).to.equal(25);
      expect(co.modifiedBy).to.equal(OWNER);

      const [bill] = await bills();
      expect(co.billRef?.id).to.equal(bill.id);
      expect(bill.data.amount).to.equal(25);
      expect(bill.data.paidVia).to.equal("wallee_terminal");
      expect(bill.data.paidAt?.toDate().toISOString()).to.equal("2026-10-16T07:39:04.865Z");
      expect(bill.data.paymentMethodConfirmationSource).to.equal("terminal");
      expect(bill.data.walleeTransactionId).to.equal(9001);
      expect(bill.data.walleeReceiptText).to.equal(RECEIPT);
      expect(bill.data.walleePaymentBrand).to.equal("Mastercard");
      // onBillCreate runs PDF, mail and membership for it.
      expect(isCommittedAtClose(bill.data)).to.equal(true);
    });

    it("is idempotent, also for deliveries racing each other", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      wallee.pay(9001, reference, 25);

      const outcomes = await Promise.all([
        settleTerminalPayment(9001, "webhook"),
        settleTerminalPayment(9001, "webhook"),
        settleTerminalPayment(9001, "reconcile"),
      ]);
      expect(outcomes.filter((o) => o === "settled")).to.have.length(1);
      expect(outcomes.filter((o) => o === "already-settled")).to.have.length(2);
      expect(await bills()).to.have.length(1);
    });

    it("settles a stale attempt paid after a newer one was prepared", async () => {
      await seedOpenCheckout("co1");
      const first = await prepare("co1");
      await prepare("co1", 5);
      wallee.pay(9001, first.reference, 25);
      expect(await settleTerminalPayment(9001, "webhook")).to.equal("settled");
      expect((await checkout("co1")).summary?.tip).to.equal(0);
    });

    it("closes an unchanged visit without a change alert", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      expect((await checkout("co1")).terminalAttempts?.["1"]?.items).to.have.keys("i0");
      wallee.pay(9001, reference, 25);
      expect(await settleTerminalPayment(9001, "webhook")).to.equal("settled");
      expect(await alertMarkers()).to.have.length(0);
    });

    describe("a visit changed after the payment was started", () => {
      const itemsCol = () => getFirestore().collection("checkouts").doc("co1").collection("items");
      const item = (description: string, quantity: number, unitPrice: number, extra = {}) => ({
        workshop: "holz",
        description,
        origin: "manual",
        catalogId: null,
        created: Timestamp.now(),
        quantity,
        unitPrice,
        totalPrice: quantity * unitPrice,
        ...extra,
      });

      async function settleAndExpectAsPriced(): Promise<void> {
        expect(await settleTerminalPayment(9001, "webhook")).to.equal("settled");
        const co = await checkout("co1");
        expect(co.status).to.equal("closed");
        expect(co.summary?.totalPrice).to.equal(25);
        expect((await bills())[0].data.amount).to.equal(25);
        const items = (await itemsCol().get()).docs;
        expect(items.map((d) => d.id)).to.deep.equal(["i0"]);
        expect(items[0].data()).to.include({ description: "Brett", quantity: 1, totalPrice: 10 });
        // Seen again by the reconcile: still one alert.
        expect(await settleTerminalPayment(9001, "reconcile")).to.equal("already-settled");
        const markers = await alertMarkers();
        expect(markers.map((m) => m.id)).to.deep.equal(["9001_checkout-changed"]);
      }

      it("books what was priced when an item was added", async () => {
        await seedOpenCheckout("co1");
        const { reference } = await prepare("co1");
        await itemsCol().doc("i1").set(item("Leim", 1, 4));
        wallee.pay(9001, reference, 25);
        await settleAndExpectAsPriced();
      });

      it("books what was priced when a quantity changed", async () => {
        await seedOpenCheckout("co1");
        const { reference } = await prepare("co1");
        await itemsCol().doc("i0").update({ quantity: 3, totalPrice: 30 });
        wallee.pay(9001, reference, 25);
        await settleAndExpectAsPriced();
      });

      it("books what was priced when an item was removed", async () => {
        await seedOpenCheckout("co1");
        const { reference } = await prepare("co1");
        await itemsCol().doc("i0").delete();
        wallee.pay(9001, reference, 25);
        await settleAndExpectAsPriced();
      });

      it("books the priced persons when the roster changed", async () => {
        await seedOpenCheckout("co1");
        const { reference } = await prepare("co1");
        await getFirestore().collection("checkouts").doc("co1").update({
          persons: [ADULT, { name: "Bob", email: "bob@example.com", userType: "erwachsen" }],
        });
        wallee.pay(9001, reference, 25);
        await settleAndExpectAsPriced();
        expect((await checkout("co1")).persons).to.have.length(1);
      });

      it("leaves machine time that arrived later unbilled and reports it", async () => {
        const db = getFirestore();
        await seedOpenCheckout("co1");
        // Replace the material line by a machine row holding one session
        // (0.5 h at CHF 20 = CHF 10, so the total stays 25).
        await itemsCol().doc("i0").set(
          item("Brett", 1, 10, { type: "machine", origin: "nfc", quantity: 0.5, unitPrice: 20 }),
        );
        const rowRef = itemsCol().doc("i0");
        const usage = (id: string) =>
          db.collection("usage_machine").doc(id).set({
            userId: db.collection("users").doc(OWNER),
            machine: db.collection("machine").doc("m1"),
            checkoutItemRef: rowRef,
            workshop: "holz",
          });
        await usage("u1");
        const { reference } = await prepare("co1");
        expect((await checkout("co1")).terminalAttempts?.["1"]?.machineUsageIds).to.deep.equal({
          i0: ["u1"],
        });
        // A session uploaded during the payment accumulates onto the row.
        await usage("u2");
        await rowRef.update({ quantity: 1, totalPrice: 20 });
        wallee.pay(9001, reference, 25);

        // The CJS module object: the namespace import of it can't be spied on.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const logger = require("firebase-functions/logger") as { warn: (...a: unknown[]) => void };
        const warn = sinon.spy(logger, "warn");
        try {
          expect(await settleTerminalPayment(9001, "webhook")).to.equal("settled");
          const alert = warn.getCalls().find((c) => c.args[0] === "terminal_checkout_changed");
          const fields = alert?.args[1] as { changes?: { lostUsageIds?: string[] } } | undefined;
          expect(fields?.changes?.lostUsageIds).to.deep.equal(["u2"]);
        } finally {
          warn.restore();
        }
        expect((await rowRef.get()).data()).to.include({ quantity: 0.5, totalPrice: 10 });
        // Both stay linked: the late session is never picked up again by a
        // later upload, so it can't be billed on another visit.
        const u1 = (await db.collection("usage_machine").doc("u1").get()).data();
        const u2 = (await db.collection("usage_machine").doc("u2").get()).data();
        expect(u1?.checkoutItemRef?.path).to.equal(rowRef.path);
        expect(u2?.checkoutItemRef?.path).to.equal(rowRef.path);
        expect(u1?.notBilledReason).to.equal(undefined);
        expect(u2?.notBilledReason).to.equal("after_verified_payment");
        expect((await alertMarkers()).map((m) => m.id)).to.deep.equal(["9001_checkout-changed"]);
      });
    });

    it("leaves the checkout open for what isn't a paid payment of ours", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      wallee.pay(1, reference, 25, { state: "FAILED" });
      wallee.pay(2, reference, 25, { terminalId: 999 });
      wallee.pay(3, "S-co1-1", 25);
      wallee.pay(4, "P-nosuchcheckout-1", 25);
      wallee.pay(5, "P-co1-7", 25);
      wallee.pay(6, reference, 24.5);

      expect(await settleTerminalPayment(1, "webhook")).to.equal("ignored");
      expect(await settleTerminalPayment(2, "webhook")).to.equal("ignored");
      expect(await settleTerminalPayment(3, "webhook")).to.equal("other-environment");
      expect(await settleTerminalPayment(4, "webhook")).to.equal("unmatched");
      expect(await settleTerminalPayment(5, "webhook")).to.equal("unmatched");
      expect(await settleTerminalPayment(6, "webhook")).to.equal("amount-mismatch");
      expect((await checkout("co1")).status).to.equal("open");
      expect(await bills()).to.have.length(0);
    });

    it("reports a double charge when the checkout was already closed", async () => {
      await seedOpenCheckout("co1");
      const first = await prepare("co1");
      const second = await prepare("co1");
      wallee.pay(9001, second.reference, 25);
      wallee.pay(9002, first.reference, 25);
      expect(await settleTerminalPayment(9001, "webhook")).to.equal("settled");
      expect(await settleTerminalPayment(9002, "webhook")).to.equal("double-charge");
      expect(await bills()).to.have.length(1);
    });

    it("settles without the receipt text when Wallee can't render it", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      wallee.pay(9001, reference, 25);
      wallee.receiptFails = true;
      expect(await settleTerminalPayment(9001, "webhook")).to.equal("settled");
      expect((await bills())[0].data.walleeReceiptText).to.equal(null);
    });
  });

  describe("the close and the overnight commit", () => {
    it("refuses the terminal as a client-confirmed method", async () => {
      await seedOpenCheckout("co1");
      await expectRejects(
        closeCheckoutAndGetPaymentHandler(
          request({ checkoutId: "co1", persons: wirePersons, paymentMethod: "wallee_terminal" }) as never,
        ),
        "invalid-argument",
      );
    });

    it("drops the attempts when the person closes with another method", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      await closeCheckoutAndGetPaymentHandler(
        request({ checkoutId: "co1", persons: wirePersons, paymentMethod: "rechnung" }) as never,
      );
      expect((await checkout("co1")).terminalAttempts).to.equal(undefined);
      // Money that still arrives for the attempt is a double charge.
      wallee.pay(9001, reference, 25);
      expect(await settleTerminalPayment(9001, "webhook")).to.equal("double-charge");
    });
  });

  describe("walleeWebhook", () => {
    const body = (entityId: number, spaceId = 100) =>
      Buffer.from(
        JSON.stringify({
          entityId,
          eventId: 1,
          listenerEntityId: 1472041829003,
          listenerEntityTechnicalName: "Transaction",
          spaceId,
          state: "AUTHORIZED",
          timestamp: "2026-10-16T07:39:05+0000",
          webhookListenerId: 2,
        }),
      );
    const deliver = (raw: Buffer, signature: string | undefined = "algorithm=SHA256withECDSA, keyId=k, signature=s") =>
      handleWalleeWebhook({ method: "POST", rawBody: raw, signature });

    it("settles on a valid delivery", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      wallee.pay(9001, reference, 25);
      expect(await deliver(body(9001))).to.deep.equal({ status: 200, body: "settled" });
      expect((await checkout("co1")).status).to.equal("closed");
    });

    it("refuses a bad or missing signature", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      wallee.pay(9001, reference, 25);
      wallee.signatureValid = false;
      expect((await deliver(body(9001))).status).to.equal(401);
      expect((await deliver(body(9001), undefined)).status).to.equal(401);
      expect((await checkout("co1")).status).to.equal("open");
    });

    it("acknowledges what isn't ours without acting", async () => {
      expect(await deliver(body(9001, 999))).to.deep.equal({ status: 200, body: "ignored" });
      expect(await deliver(Buffer.from("{}"))).to.deep.equal({ status: 200, body: "ignored" });
    });

    it("asks Wallee to retry on a transient failure", async () => {
      wallee.failReads = true;
      expect((await deliver(body(9001))).status).to.equal(500);
    });

    it("asks Wallee to retry when the SDK can't be set up", async () => {
      const stub = sinon.stub(walleeModule, "walleeApi").rejects(new Error("no key"));
      try {
        expect(await deliver(body(9001))).to.deep.equal({ status: 503, body: "retry" });
      } finally {
        stub.restore();
      }
    });

    it("answers 500 instead of rejecting on an unexpected error", async () => {
      const stub = sinon.stub(walleeModule, "walleeConfig").throws(new Error("boom"));
      try {
        expect(
          await handleWalleeWebhookSafely({ method: "POST", rawBody: body(9001), signature: "s" }),
        ).to.deep.equal({ status: 500, body: "retry" });
      } finally {
        stub.restore();
      }
    });

    it("refuses other methods and oversized bodies", async () => {
      expect((await handleWalleeWebhook({ method: "GET", rawBody: undefined, signature: undefined })).status).to.equal(405);
      expect((await deliver(Buffer.alloc(20000, 0x20))).status).to.equal(400);
    });
  });

  describe("reconcileTerminalPayments", () => {
    it("settles a payment whose webhook was lost and checks the listener", async () => {
      await seedOpenCheckout("co1");
      const { reference } = await prepare("co1");
      wallee.pay(9001, reference, 25);
      // A sale keyed in on the terminal: its own number as reference.
      wallee.pay(9002, "000000001", 3);

      const report = await runReconcileTerminalPayments();
      expect(report?.outcomes).to.deep.equal({ settled: 1, unmatched: 1 });
      expect(report?.listenerActive).to.equal(true);
      expect((await checkout("co1")).status).to.equal("closed");
      expect(wallee.receiptCalls).to.equal(1);

      // A second night finds it settled, without asking Wallee for the
      // receipt again, and doesn't alert about the terminal sale again.
      const again = await runReconcileTerminalPayments();
      expect(again?.outcomes).to.deep.equal({ "already-settled": 1, unmatched: 1 });
      expect(wallee.receiptCalls).to.equal(1);
      expect((await alertMarkers()).map((d) => d.id)).to.deep.equal(["9002_unmatched"]);
    });

    it("alerts a double charge once, however often it is seen", async () => {
      await seedOpenCheckout("co1");
      const first = await prepare("co1");
      const second = await prepare("co1");
      wallee.pay(9001, second.reference, 25);
      wallee.pay(9002, first.reference, 25);
      expect(await settleTerminalPayment(9001, "webhook")).to.equal("settled");
      expect(await settleTerminalPayment(9002, "webhook")).to.equal("double-charge");
      await runReconcileTerminalPayments();
      await runReconcileTerminalPayments();
      const markers = await alertMarkers();
      expect(markers.map((d) => d.id)).to.deep.equal(["9002_double-charge"]);
      expect(markers[0].data().reference).to.equal(first.reference);
      // The duplicate's receipt is never fetched: it can't settle.
      expect(wallee.receiptCalls).to.equal(1);
    });

    it("notices a deactivated listener", async () => {
      wallee.listeners = [{ id: 1, name: walleeListenerName(process.env.GCLOUD_PROJECT ?? ""), state: "INACTIVE" }];
      const report = await runReconcileTerminalPayments();
      expect(report?.listenerActive).to.equal(false);
    });
  });
});
