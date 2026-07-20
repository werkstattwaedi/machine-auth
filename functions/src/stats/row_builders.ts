// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pure Firestore-doc → BigQuery-row builders for the stats export (ADR-0039).
 *
 * No I/O here: callers resolve the subject key, membership flag, and export
 * timestamp and pass them in, so the builders are trivially unit-testable
 * and reusable by erasure's flush-before-delete path.
 *
 * Privacy: rows carry only what `stats/schema.ts` declares — never names,
 * emails, tag UIDs, referenceNumbers, or storagePaths. Event timestamps are
 * truncated to the hour (decided hardening); dates are Zurich-local.
 */

import { Timestamp } from "firebase-admin/firestore";
import { formatInTimeZone } from "date-fns-tz";
import { getWorkshopTimezone } from "../util/workshop_timezone";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  MembershipEntity,
  UsageMachineEntity,
} from "../types/firestore_entities";
import type { BillEntity } from "../invoice/types";

export type StatsRow = Record<string, unknown>;

/** Context shared by all rows of one export run. */
export interface RowContext {
  /** ISO timestamp of the export run (`now.toISOString()`). */
  exportedAt: string;
}

/** Zurich-local calendar date (yyyy-MM-dd) of a timestamp. */
export function localDate(ts: Timestamp): string {
  return formatInTimeZone(ts.toDate(), getWorkshopTimezone(), "yyyy-MM-dd");
}

/** ISO timestamp truncated to the hour (re-identification hardening). */
export function truncateToHourIso(ts: Timestamp): string {
  const d = ts.toDate();
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

export function buildVisitRow(
  checkoutId: string,
  checkout: CheckoutEntity,
  items: CheckoutItemEntity[],
  subjectKey: string | null,
  isMember: boolean,
  ctx: RowContext
): StatsRow {
  if (!checkout.closedAt) {
    throw new Error(`buildVisitRow: checkout ${checkoutId} has no closedAt`);
  }
  const itemWorkshops = items.map((i) => i.workshop).filter(Boolean);
  const workshops = [
    ...new Set(itemWorkshops.length ? itemWorkshops : checkout.workshopsVisited ?? []),
  ];
  const persons = checkout.persons ?? [];
  const summary = checkout.summary;
  return {
    doc_id: checkoutId,
    exported_at: ctx.exportedAt,
    visit_date: localDate(checkout.closedAt),
    closed_at: truncateToHourIso(checkout.closedAt),
    subject_key: subjectKey,
    is_registered: checkout.userId != null,
    usage_type: checkout.usageType ?? null,
    workshops,
    person_count: persons.length,
    user_types: persons.map((p) => p.userType),
    is_member: isMember,
    total_price: summary?.totalPrice ?? null,
    entry_fees: summary?.entryFees ?? null,
    machine_cost: summary?.machineCost ?? null,
    material_cost: summary?.materialCost ?? null,
    tip: summary?.tip ?? null,
    discount_amount: summary?.discountAmount ?? 0,
  };
}

export function buildVisitItemRows(
  checkoutId: string,
  checkout: CheckoutEntity,
  items: Array<{ id: string; data: CheckoutItemEntity }>,
  subjectKey: string | null,
  ctx: RowContext
): StatsRow[] {
  if (!checkout.closedAt) {
    throw new Error(`buildVisitItemRows: checkout ${checkoutId} has no closedAt`);
  }
  const visitDate = localDate(checkout.closedAt);
  return items.map(({ id, data }) => ({
    doc_id: `${checkoutId}/${id}`,
    exported_at: ctx.exportedAt,
    checkout_id: checkoutId,
    visit_date: visitDate,
    subject_key: subjectKey,
    workshop: data.workshop ?? null,
    item_type: data.type ?? "material",
    catalog_id: data.catalogId?.id ?? null,
    quantity: data.quantity ?? null,
    unit_price: data.unitPrice ?? null,
    total_price: data.totalPrice ?? null,
    origin: data.origin ?? null,
  }));
}

export function buildMachineUsageRow(
  usageId: string,
  usage: UsageMachineEntity,
  subjectKey: string | null,
  ctx: RowContext
): StatsRow {
  // activeSeconds/billableSeconds are written by handle_upload_usage but were
  // missing from UsageMachineEntity until this feature; read defensively.
  const raw = usage as UsageMachineEntity & {
    activeSeconds?: number;
    billableSeconds?: number;
  };
  return {
    doc_id: usageId,
    exported_at: ctx.exportedAt,
    usage_date: localDate(usage.endTime),
    subject_key: subjectKey,
    machine: usage.machine?.id ?? null,
    workshop: usage.workshop ?? null,
    start_time: truncateToHourIso(usage.startTime),
    end_time: truncateToHourIso(usage.endTime),
    active_seconds: raw.activeSeconds ?? null,
    billable_seconds: raw.billableSeconds ?? null,
  };
}

export function buildBillRow(
  billId: string,
  bill: BillEntity,
  subjectKey: string | null,
  ctx: RowContext
): StatsRow {
  if (!bill.paidAt) {
    throw new Error(`buildBillRow: bill ${billId} is not paid`);
  }
  // Deliberately NO referenceNumber and NO storagePath — the (date, amount)
  // join to the escrowed PDF archive is the accepted residual; these two
  // fields would make re-linking trivial (ADR-0039).
  return {
    doc_id: billId,
    exported_at: ctx.exportedAt,
    paid_date: localDate(bill.paidAt),
    paid_at: bill.paidAt.toDate().toISOString(),
    subject_key: subjectKey,
    amount: bill.amount ?? null,
    paid_via: bill.paidVia ?? null,
    kind: bill.kind ?? "invoice",
    source: bill.source ?? "checkout",
  };
}

export function buildMembershipSnapshotRow(
  membershipId: string,
  membership: MembershipEntity,
  /** Zurich month being snapshotted, `yyyy-MM`. */
  month: string,
  ownerSubjectKey: string | null,
  ctx: RowContext
): StatsRow {
  return {
    doc_id: `${membershipId}/${month}`,
    exported_at: ctx.exportedAt,
    snapshot_date: `${month}-01`,
    type: membership.type ?? null,
    member_count: membership.members?.length ?? 0,
    owner_subject_key: ownerSubjectKey,
    valid_until: membership.validUntil ? localDate(membership.validUntil) : null,
  };
}
