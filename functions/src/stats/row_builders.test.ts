// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the stats row builders (ADR-0039). These pin the privacy
 * contract: which fields reach BigQuery, hour truncation, Zurich dates, and
 * the referenceNumber/storagePath exclusion on bill rows.
 */

import { expect } from "chai";
import { DocumentReference, Timestamp } from "firebase-admin/firestore";
import {
  buildBillRow,
  buildMachineUsageRow,
  buildMembershipSnapshotRow,
  buildVisitItemRows,
  buildVisitRow,
  localDate,
  truncateToHourIso,
  type RowContext,
} from "./row_builders";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  MembershipEntity,
  UsageMachineEntity,
} from "../types/firestore_entities";
import type { BillEntity } from "../invoice/types";

const ctx: RowContext = { exportedAt: "2026-07-19T05:00:00.000Z" };

function ref(id: string): DocumentReference {
  return { id } as unknown as DocumentReference;
}

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

const closedCheckout: CheckoutEntity = {
  userId: ref("user-1"),
  status: "closed",
  usageType: "regular",
  created: ts("2026-03-14T10:00:00Z"),
  closedAt: ts("2026-03-14T13:45:23Z"),
  workshopsVisited: ["holz"],
  persons: [
    { name: "A", email: "a@example.com", userType: "erwachsen" },
    { name: "B", email: "b@example.com", userType: "kind" },
  ],
  modifiedBy: null,
  modifiedAt: ts("2026-03-14T13:45:23Z"),
  summary: {
    totalPrice: 42.5,
    entryFees: 10,
    machineCost: 20,
    materialCost: 10,
    tip: 2.5,
    discountAmount: 0,
  },
};

const items: Array<{ id: string; data: CheckoutItemEntity }> = [
  {
    id: "item-1",
    data: {
      workshop: "holz",
      description: "Brett Eiche",
      origin: "manual",
      catalogId: ref("cat-7"),
      variantId: "default",
      created: ts("2026-03-14T11:00:00Z"),
      quantity: 2,
      unitPrice: 5,
      totalPrice: 10,
    },
  },
  {
    id: "item-2",
    data: {
      workshop: "metall",
      description: "Laser",
      origin: "nfc",
      type: "machine",
      catalogId: null,
      created: ts("2026-03-14T12:00:00Z"),
      quantity: 1,
      unitPrice: 20,
      totalPrice: 20,
    },
  },
];

describe("stats row builders", () => {
  it("truncates timestamps to the hour", () => {
    expect(truncateToHourIso(ts("2026-03-14T13:45:23.987Z"))).to.equal(
      "2026-03-14T13:00:00.000Z"
    );
  });

  it("computes Zurich-local dates across the midnight boundary", () => {
    // 23:30 UTC on the 14th is already 00:30 on the 15th in Zurich (CET).
    expect(localDate(ts("2026-03-14T23:30:00Z"))).to.equal("2026-03-15");
  });

  describe("buildVisitRow", () => {
    it("maps a closed checkout with summary", () => {
      const row = buildVisitRow(
        "co-1",
        closedCheckout,
        items.map((i) => i.data),
        "subject-key-1",
        true,
        ctx
      );
      expect(row).to.deep.equal({
        doc_id: "co-1",
        exported_at: ctx.exportedAt,
        visit_date: "2026-03-14",
        closed_at: "2026-03-14T13:00:00.000Z",
        subject_key: "subject-key-1",
        is_registered: true,
        usage_type: "regular",
        workshops: ["holz", "metall"],
        person_count: 2,
        user_types: ["erwachsen", "kind"],
        is_member: true,
        total_price: 42.5,
        entry_fees: 10,
        machine_cost: 20,
        material_cost: 10,
        tip: 2.5,
        discount_amount: 0,
      });
    });

    it("never leaks person names or emails", () => {
      const row = buildVisitRow(
        "co-1",
        closedCheckout,
        [],
        null,
        false,
        ctx
      );
      const json = JSON.stringify(row);
      expect(json).to.not.include("a@example.com");
      expect(json).to.not.match(/"name"/);
    });

    it("handles an anonymous checkout without summary", () => {
      const anon: CheckoutEntity = {
        ...closedCheckout,
        userId: null as unknown as DocumentReference,
        firebaseUid: "anon-uid",
        summary: undefined,
      };
      const row = buildVisitRow("co-2", anon, [], "anon-key", false, ctx);
      expect(row.is_registered).to.equal(false);
      expect(row.subject_key).to.equal("anon-key");
      expect(row.total_price).to.equal(null);
    });

    it("falls back to workshopsVisited when there are no items", () => {
      const row = buildVisitRow("co-1", closedCheckout, [], null, false, ctx);
      expect(row.workshops).to.deep.equal(["holz"]);
    });
  });

  describe("buildVisitItemRows", () => {
    it("maps items with catalog ids and machine typing", () => {
      const rows = buildVisitItemRows("co-1", closedCheckout, items, "k", ctx);
      expect(rows).to.have.length(2);
      expect(rows[0]).to.include({
        doc_id: "co-1/item-1",
        checkout_id: "co-1",
        visit_date: "2026-03-14",
        subject_key: "k",
        workshop: "holz",
        item_type: "material",
        catalog_id: "cat-7",
        quantity: 2,
        unit_price: 5,
        total_price: 10,
        origin: "manual",
      });
      expect(rows[1]).to.include({ item_type: "machine", catalog_id: null });
      // The badge tokenId (tag UID) must never reach BigQuery.
      expect(JSON.stringify(rows)).to.not.match(/tokenId/);
    });
  });

  describe("buildMachineUsageRow", () => {
    it("maps a completed usage incl. the type-gap seconds fields", () => {
      const usage = {
        userId: ref("user-1"),
        authenticationId: null,
        machine: ref("laser-1"),
        startTime: ts("2026-05-01T09:12:00Z"),
        endTime: ts("2026-05-01T10:40:00Z"),
        workshop: "metall",
        activeSeconds: 3300,
        billableSeconds: 5280,
      } as unknown as UsageMachineEntity;
      const row = buildMachineUsageRow("u-1", usage, "k", ctx);
      expect(row).to.deep.equal({
        doc_id: "u-1",
        exported_at: ctx.exportedAt,
        usage_date: "2026-05-01",
        subject_key: "k",
        machine: "laser-1",
        workshop: "metall",
        start_time: "2026-05-01T09:00:00.000Z",
        end_time: "2026-05-01T10:00:00.000Z",
        active_seconds: 3300,
        billable_seconds: 5280,
      });
    });
  });

  describe("buildBillRow", () => {
    const bill = {
      userId: ref("user-1"),
      referenceNumber: 260001234,
      amount: 42.5,
      currency: "CHF",
      storagePath: "invoices/b-1.pdf",
      created: ts("2026-06-01T08:00:00Z"),
      paidAt: ts("2026-06-03T18:22:10Z"),
      paidVia: "twint",
    } as unknown as BillEntity;

    it("maps a paid bill and excludes the re-link vectors", () => {
      const row = buildBillRow("b-1", bill, "k", ctx);
      expect(row).to.deep.equal({
        doc_id: "b-1",
        exported_at: ctx.exportedAt,
        paid_date: "2026-06-03",
        paid_at: "2026-06-03T18:22:10.000Z",
        subject_key: "k",
        amount: 42.5,
        paid_via: "twint",
        kind: "invoice",
        source: "checkout",
      });
      expect(Object.keys(row)).to.not.include("referenceNumber");
      expect(JSON.stringify(row)).to.not.include("invoices/");
    });

    it("refuses unpaid bills", () => {
      const unpaid = { ...bill, paidAt: null } as unknown as BillEntity;
      expect(() => buildBillRow("b-2", unpaid, "k", ctx)).to.throw(/not paid/);
    });
  });

  describe("buildMembershipSnapshotRow", () => {
    it("maps an active membership for a month", () => {
      const membership = {
        type: "family",
        status: "active",
        lastPaidAt: null,
        validUntil: ts("2027-02-01T00:00:00Z"),
        ownerUserId: ref("user-1"),
        members: [ref("user-1"), ref("user-2")],
        paymentCheckouts: [],
      } as unknown as MembershipEntity;
      const row = buildMembershipSnapshotRow(
        "m-1",
        membership,
        "2026-07",
        "owner-key",
        ctx
      );
      expect(row).to.deep.equal({
        doc_id: "m-1/2026-07",
        exported_at: ctx.exportedAt,
        snapshot_date: "2026-07-01",
        type: "family",
        member_count: 2,
        owner_subject_key: "owner-key",
        valid_until: "2027-02-01",
      });
    });
  });
});
