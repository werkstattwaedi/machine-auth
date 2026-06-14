// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Bill lifecycle triggers and retry:
 * - onBillCreate: fast path — attempt PDF generation + email
 * - retryBillProcessing: scheduled every 15 min — retry failures
 *
 * PDF generation and email sending use optimistic locking via timestamp
 * fields (pdfGeneratedAt, emailSentAt) to prevent concurrent processing.
 * Failures are logged to the operations_log collection for debugging.
 */

import * as logger from "firebase-functions/logger";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import { DocumentReference, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { formatWorkshopDateTime } from "../util/workshop_timezone";
import { formatBillReference } from "./types";
import { logOperationError } from "../operations_log";
import { assertTemplateConfigured } from "../util/resend_template";
import { loadMembershipCatalogId } from "../membership/shared";
import { processMembershipForAckedBill } from "../membership/process_membership_payment";
import type {
  BillEntity,
  InvoiceData,
  InvoiceCheckout,
  PaymentConfig,
  WorkshopInfo,
  PersonEntryFee,
} from "./types";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  PaymentMethod,
  UserEntity,
} from "../types/firestore_entities";

// --- Params ---

const paymentIban = defineString("PAYMENT_IBAN");
const paymentRecipientName = defineString("PAYMENT_RECIPIENT_NAME");
const paymentRecipientStreet = defineString("PAYMENT_RECIPIENT_STREET");
const paymentRecipientPostalCode = defineString("PAYMENT_RECIPIENT_POSTAL_CODE");
const paymentRecipientCity = defineString("PAYMENT_RECIPIENT_CITY");
const paymentRecipientCountry = defineString("PAYMENT_RECIPIENT_COUNTRY");
const paymentCurrency = defineString("PAYMENT_CURRENCY");

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineString("RESEND_FROM_EMAIL");
const resendQrBillTemplateId = defineString("RESEND_QRBILL_TEMPLATE_ID");
// Issue #251: method-aware invoice emails. Ops repo populates the values;
// emulator runs send fine with empty defaults via assertTemplateConfigured.
const resendMonthlyTemplateId = defineString(
  "RESEND_MONTHLY_TEMPLATE_ID",
  { default: "" },
);
const resendTwintTemplateId = defineString(
  "RESEND_TWINT_TEMPLATE_ID",
  { default: "" },
);
// Aggregated Sammelrechnung email (issue #245). Repurposes the existing
// `RESEND_MONTHLY_TEMPLATE_ID` ops param — per-visit Belege no longer
// email, so the template content shifts from "queued for monthly" to
// "your Sammelrechnung is ready" via an ops template-copy update. Falls
// back to the generic QR-bill template when unset (emulator mode).
const resendSammelrechnungTemplateId = resendMonthlyTemplateId;
// Contact address surfaced on the TWINT email ("contact kasse@... if in
// error"). Set in the operations repo per env.
const kasseEmail = defineString("KASSE_EMAIL", { default: "" });

// Stale lock threshold: if a lock is older than this, treat it as failed
const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Thrown by `assembleInvoiceData` when none of a bill's referenced
 * checkouts still exist (issue #364). This is an expected lifecycle
 * outcome — the only realistic way a bill loses *all* its checkouts is
 * the documented cleanup/delete path (e2e `clearCollections`,
 * `cleanupAbandonedCheckouts` #318, admin delete). `tryGeneratePdf`
 * catches this specific type, skips the PDF, and does NOT write an
 * `operations_log` entry, so it doesn't masquerade as a genuine PDF
 * failure. Any other error keeps the existing error + operations_log path.
 */
export class MissingCheckoutsError extends Error {
  constructor(billId: string) {
    super(`Bill ${billId}: all referenced checkouts are missing`);
    this.name = "MissingCheckoutsError";
  }
}

/**
 * Standard (regular) per-person entry fee from
 * `config/pricing.entryFees.{userType}.regular`. The usage-type discount
 * is applied separately by the renderer (issue #284) so the invoice can
 * show the raw fee with a per-section "waived" note rather than a silent
 * zero. The `usageType` argument is kept for error context only.
 *
 * Throws when the config row is missing (issue #149). The previous silent
 * fallback shipped hardcoded prices that diverged from the seeded
 * production values, so a misconfigured Firestore document would have
 * silently misbilled every checkout. Throwing here puts the bill into
 * the documented "needs ops attention" state via the trigger's existing
 * logOperationError path instead of emitting a wrong PDF.
 */
function calculateEntryFee(
  userType: string,
  usageType: string,
  configFees?: Record<string, Record<string, number>> | null,
): number {
  if (configFees) {
    const row = configFees[userType];
    if (row && "regular" in row) {
      const standard = row["regular"];
      if (typeof standard === "number") return standard;
    }
  }
  throw new Error(
    `Pricing config missing standard entry fee for ${userType} (usageType ${usageType})`,
  );
}

// --- Helpers ---

function buildPaymentConfig(): PaymentConfig {
  return {
    iban: paymentIban.value(),
    recipientName: paymentRecipientName.value(),
    recipientStreet: paymentRecipientStreet.value(),
    recipientPostalCode: paymentRecipientPostalCode.value(),
    recipientCity: paymentRecipientCity.value(),
    recipientCountry: paymentRecipientCountry.value(),
    currency: paymentCurrency.value() || "CHF",
  };
}

/**
 * Assemble InvoiceData from a bill and its checkouts.
 */
async function assembleInvoiceData(
  bill: BillEntity,
  billId: string,
): Promise<InvoiceData> {
  const db = getFirestore();

  // Load pricing config
  const pricingDoc = await db.doc("config/pricing").get();
  const pricingData = pricingDoc.data() as {
    workshops?: Record<string, WorkshopInfo>;
    entryFees?: Record<string, Record<string, number>>;
  } | undefined;
  const workshops = pricingData?.workshops ?? {};
  const configFees = pricingData?.entryFees ?? null;

  // Issue #262/#263: resolve the Vereinsmitgliedschaft catalog id once so the
  // renderer can break membership items out of the workshop groups into a
  // dedicated "Mitgliedschaft" block. Null when no membership SKU is
  // configured — the renderer then groups items exactly as before.
  const membershipCatalogId = await loadMembershipCatalogId(db);

  // Load all checkouts. A referenced checkout may no longer exist
  // (issue #364): e2e `clearCollections`, `cleanupAbandonedCheckouts`
  // (#318), or an admin delete can remove a checkout while a bill still
  // references it. `doc.data()` would be `undefined` and reading
  // `.persons` throws — so partition into present/missing and only work
  // with the survivors. Keep the present docs in their original order so
  // the index-based zip with `checkoutItems` stays aligned.
  const allCheckoutDocs = await Promise.all(
    bill.checkouts.map((ref) => ref.get()),
  );

  const checkoutDocs = allCheckoutDocs.filter((doc) => doc.exists);
  for (const doc of allCheckoutDocs) {
    if (!doc.exists) {
      logger.warn(
        `assembleInvoiceData: bill ${billId} references missing checkout ${doc.ref.path}, skipping it`,
      );
    }
  }

  // No surviving checkouts — nothing to render. Signal the expected
  // missing-checkouts lifecycle so the caller skips the PDF without
  // logging a spurious operations_log error.
  if (checkoutDocs.length === 0) {
    throw new MissingCheckoutsError(billId);
  }

  const checkoutItems = await Promise.all(
    checkoutDocs.map(async (doc) => {
      const itemsSnap = await doc.ref.collection("items").get();
      return itemsSnap.docs.map((d) => d.data() as CheckoutItemEntity);
    }),
  );

  // Assemble invoice checkouts
  const invoiceCheckouts: InvoiceCheckout[] = checkoutDocs.map((doc, i) => {
    const data = doc.data() as CheckoutEntity;
    const items = checkoutItems[i];

    // Daily-fee dedup (issue #268): a person flagged `entryFeeWaivedToday`
    // already paid the daily usage fee earlier the same Zurich business
    // day, so the close path zeroed their contribution to the bill total.
    // Re-derive their fee as 0 here too so the PDF's per-person breakdown
    // stays consistent with the billed amount; `waivedToday` lets the
    // renderer annotate the row ("heute bereits abgerechnet").
    const personEntryFees: PersonEntryFee[] = data.persons.map((person) => ({
      name: person.name,
      userType: person.userType,
      fee: person.entryFeeWaivedToday
        ? 0
        : calculateEntryFee(person.userType, data.usageType, configFees),
      waivedToday: person.entryFeeWaivedToday === true,
    }));
    const entryFees = personEntryFees.reduce((sum, pf) => sum + pf.fee, 0);

    const machineCost = data.summary?.machineCost ?? 0;
    const materialCost = data.summary?.materialCost ?? 0;
    const tip = data.summary?.tip ?? 0;
    const totalPrice = data.summary?.totalPrice ?? (entryFees + machineCost + materialCost + tip);

    return {
      date: data.created.toDate(),
      usageType: data.usageType,
      persons: data.persons,
      personEntryFees,
      items,
      workshopsVisited: data.workshopsVisited,
      entryFees,
      machineCost,
      materialCost,
      tip,
      totalPrice,
    };
  });

  // Determine the recipient block (issue #269):
  //   1. firma person with a person-level billingAddress → use it (company
  //      identifies the recipient, no separate person-name line).
  //   2. else, if the first person is linked to a registered user via
  //      `userRef` and that user has a non-empty `billingAddress`, surface
  //      it as the recipient address with `company` left empty — the PDF
  //      renders person-name + street + zip/city (standard CH invoice).
  //   3. else (anonymous walk-in or registered user without an address),
  //      keep `billingAddress: null` and render the person's name only.
  let billingAddress: InvoiceData["billingAddress"] = null;
  let recipientName = "";
  let firstPersonUserRef: DocumentReference | null = null;

  for (const checkout of invoiceCheckouts) {
    for (const person of checkout.persons) {
      if (person.userType === "firma" && person.billingAddress) {
        billingAddress = person.billingAddress;
        recipientName = person.billingAddress.company;
        break;
      }
      if (!recipientName) {
        recipientName = person.name;
        // Capture the userRef of whichever person we picked the name from
        // so we can look up their stored billing address.
        firstPersonUserRef = person.userRef ?? null;
      }
    }
    if (billingAddress) break;
  }
  if (!recipientName && invoiceCheckouts.length > 0) {
    recipientName = invoiceCheckouts[0].persons[0]?.name ?? "Unbekannt";
  }

  // No firma address picked up — try the registered-user fallback so a
  // standard Swiss invoice rendering has the recipient's postal address.
  if (!billingAddress && firstPersonUserRef) {
    try {
      const userSnap = await firstPersonUserRef.get();
      if (userSnap.exists) {
        const userData = userSnap.data() as UserEntity | undefined;
        const addr = userData?.billingAddress;
        if (addr && addr.street && addr.zip && addr.city) {
          billingAddress = {
            // company is intentionally blank for non-firma users — the PDF
            // skips the line and renders recipientName instead.
            company: addr.company ?? "",
            street: addr.street,
            zip: addr.zip,
            city: addr.city,
          };
        }
      }
    } catch (error) {
      // Fail soft: the bill still renders, just without the address block.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `assembleInvoiceData: failed to load user ${firstPersonUserRef.path} for billing address`,
        { error: message },
      );
    }
  }

  // Read the customer's chosen payment method from the first checkout.
  // Null at bill-create time; set after acknowledgeBill / the cron lands.
  // Gates whether the QR-bill payment slip is rendered (#251).
  // For the monthly aggregated bill (kind "invoice" with paymentMethod
  // "monthly" on every linked checkout): the bill IS the Sammelrechnung,
  // so it must show the QR slip. We don't want the
  // "Dieser Betrag wird der nächsten Sammelrechnung […] hinzugefügt"
  // notice — fall through to the rechnung path.
  const primaryCheckoutData = checkoutDocs[0]?.data() as CheckoutEntity | undefined;
  const rawPaymentMethod = primaryCheckoutData?.paymentMethod ?? null;
  const kind = bill.kind ?? "invoice";
  const paymentMethod =
    kind === "invoice" && rawPaymentMethod === "monthly"
      ? "rechnung"
      : rawPaymentMethod;

  return {
    referenceNumber: bill.referenceNumber,
    invoiceDate: new Date(),
    billingAddress,
    recipientName,
    checkouts: invoiceCheckouts,
    workshops,
    grandTotal: bill.amount,
    currency: bill.currency,
    paidAt: bill.paidAt?.toDate() ?? null,
    paidVia: bill.paidVia ?? null,
    paymentMethod,
    kind,
    membershipCatalogId,
  };
}

// --- Async processing with optimistic locking ---

/**
 * Attempt to generate a PDF for a bill. Uses pdfGeneratedAt as an
 * optimistic lock to prevent concurrent generation.
 *
 * Returns true if the PDF was generated (or already exists).
 *
 * Exported for integration testing — invoked directly to bypass the
 * Firestore trigger wrapper.
 */
export async function tryGeneratePdf(
  billId: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const db = getFirestore();
  const billRef = db.collection("bills").doc(billId);

  const billDoc = await billRef.get();
  if (!billDoc.exists) return false;
  const bill = billDoc.data() as BillEntity;

  // Already generated — `force` bypasses to allow ack-time regeneration
  // when the payment method changes the PDF content (#251).
  if (bill.storagePath && !options.force) return true;

  // Another process is working on it (and the lock isn't stale).
  //
  // `force` skips this check (issue #426): the create-path
  // `tryGeneratePdf` sets `pdfGeneratedAt` and never clears it on
  // success, so a completed bill still carries a recent timestamp. When
  // the user acks TWINT within STALE_LOCK_MS of checkout (the common
  // case), the ack-time force-regen would otherwise see that fresh
  // timestamp as a held lock and bail BEFORE regenerating — leaving the
  // create-time QR rechnung PDF attached while the email already
  // branded itself TWINT. The force callers (onBillUpdate) run
  // sequentially after the ack commit, so there is no real concurrent
  // generator to protect against here.
  if (bill.pdfGeneratedAt && !options.force) {
    const lockAge = Date.now() - bill.pdfGeneratedAt.toMillis();
    if (lockAge < STALE_LOCK_MS) return false;
    // Stale lock — clear it and proceed
    logger.warn(`Clearing stale PDF lock for bill ${billId} (${lockAge}ms old)`);
  }

  // Acquire lock
  await billRef.update({ pdfGeneratedAt: Timestamp.now() });

  try {
    const invoiceData = await assembleInvoiceData(bill, billId);
    const paymentConfig = buildPaymentConfig();
    // Lazy import: pdfkit + swissqrbill (~10 MB) shouldn't be in the cold-
    // start bundle of every other function exported from index.ts.
    const { buildInvoicePdf } = await import("./build_invoice_pdf.js");
    const pdfBuffer = await buildInvoicePdf(invoiceData, paymentConfig);

    const storagePath = `invoices/${billId}.pdf`;
    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);
    await file.save(pdfBuffer, { contentType: "application/pdf" });

    await billRef.update({ storagePath });
    logger.info(`PDF generated for bill ${billId}`);
    return true;
  } catch (error) {
    // Release lock on failure
    await billRef.update({ pdfGeneratedAt: null });

    // Expected lifecycle: the bill's checkouts were all deleted
    // (issue #364). Skip the PDF quietly — do NOT write operations_log,
    // so this doesn't masquerade as a genuine PDF failure / page anyone.
    if (error instanceof MissingCheckoutsError) {
      logger.info(
        `PDF generation skipped for bill ${billId}: ${error.message}`,
      );
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error(`PDF generation failed for bill ${billId}`, { error: message });
    await logOperationError("bills", billId, "pdf_generate", message);
    return false;
  }
}

/**
 * Attempt to send the invoice email for a bill. Uses emailSentAt as an
 * optimistic lock to prevent duplicate sends.
 *
 * Returns true if the email was sent (or already sent, or skipped in emulator).
 *
 * Exported for integration testing — invoked directly to bypass the
 * Firestore trigger wrapper.
 */
interface TemplateChoice {
  id: string;
  paramName: string;
}

function pickTemplate(
  method: PaymentMethod | null | undefined,
  bill: BillEntity,
): TemplateChoice {
  // Sammelrechnung family (issue #245/#405) uses the self-checkout/monthly
  // template (RESEND_MONTHLY_TEMPLATE_ID). Two documents share it:
  //   - the per-visit Beleg emailed when a member picks "monthly" — a
  //     receipt for the visit, NOT a payable invoice (issue #405);
  //   - the aggregated monthly Sammelrechnung (kind "invoice" whose linked
  //     checkout still records paymentMethod "monthly"), emitted by
  //     monthlyBillRun.
  // Ops owns the template copy (the existing "self-checkout-monthly"
  // template). Falls back to the generic QR-bill template when unset
  // (emulator / not-yet-configured).
  if ((bill.kind ?? "invoice") === "beleg" || method === "monthly") {
    const id = resendSammelrechnungTemplateId.value();
    return {
      id: id || resendQrBillTemplateId.value(),
      paramName: id ? "RESEND_MONTHLY_TEMPLATE_ID" : "RESEND_QRBILL_TEMPLATE_ID",
    };
  }
  // Remaining paths are TWINT, rechnung, and the null pre-ack default.
  switch (method) {
    case "twint":
      return {
        id: resendTwintTemplateId.value(),
        paramName: "RESEND_TWINT_TEMPLATE_ID",
      };
    case "rechnung":
    default:
      return {
        id: resendQrBillTemplateId.value(),
        paramName: "RESEND_QRBILL_TEMPLATE_ID",
      };
  }
}

/**
 * Resolve the invoice-email recipient for a checkout (issue #471).
 *
 * The receipt always goes to the checkout's account holder
 * (`checkout.userId`) — the payer — and to no one else, regardless of who
 * appears on the roster (`persons`). Per ADR-0029 (#439), account-less
 * family members exist only as roster members of a family whose owner is the
 * payer; they never have an email of their own. So even when the owner has
 * removed themselves from `persons` and only an account-less child remains,
 * the recipient is unambiguous: the account holder's email.
 *
 * The receipt body still shows the visiting person's name (`persons[0].name`)
 * via RECIPIENT_NAME — only the `to:` address is the account holder.
 *
 * Returns `null` (caller logs + skips) when the account holder has no email.
 *
 * Exported for unit testing.
 */
export async function resolveRecipientEmail(
  checkout: CheckoutEntity,
): Promise<string | null> {
  try {
    const ownerSnap = await checkout.userId.get();
    return (ownerSnap.data() as UserEntity | undefined)?.email || null;
  } catch (error) {
    // Fail soft: an account-holder lookup hiccup shouldn't crash the send
    // path — skip rather than throw.
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `resolveRecipientEmail: account-holder lookup failed for ${checkout.userId.path}`,
      { error: message },
    );
    return null;
  }
}

export async function trySendEmail(billId: string): Promise<boolean> {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    logger.info(`Emulator: skipping email for bill ${billId}`);
    return true;
  }

  const db = getFirestore();
  const billRef = db.collection("bills").doc(billId);

  const billDoc = await billRef.get();
  if (!billDoc.exists) return false;
  const bill = billDoc.data() as BillEntity;

  const isBeleg = (bill.kind ?? "invoice") === "beleg";

  // A Beleg (per-visit Sammelrechnung record, issue #245) is committed by
  // its kind transition (acknowledgeBill / autoAcknowledgeBills flip it to
  // "beleg") and never carries a payment-method ack stamp. The member still
  // wants an emailed receipt for the visit — just not a payable invoice
  // (issue #405). So Belege bypass the ack gate; real invoices stay gated
  // on the customer's payment-method ack (issue #251). retryBillProcessing
  // also checks this, but the helper is exported and can be called directly
  // from tests / one-off scripts — keep the guard.
  if (!isBeleg && !bill.paymentMethodConfirmationTime) return false;

  // Free bills are auto-acked at creation to keep the cron out, but we
  // don't email a "here's your zero-amount invoice" PDF.
  if (bill.paidVia === "free") return false;

  // No PDF yet — can't send email without attachment
  if (!bill.storagePath) return false;

  // Already sent or in-progress. On failure the catch block clears
  // emailSentAt to null so the retry picks it up. A process crash
  // mid-send would leave emailSentAt stuck — rare enough to handle manually.
  if (bill.emailSentAt) return false;

  // Get recipient email from first checkout
  if (bill.checkouts.length === 0) return false;
  const checkoutDoc = await bill.checkouts[0].get();
  if (!checkoutDoc.exists) return false;
  const checkout = checkoutDoc.data() as CheckoutEntity;
  // Resolve recipient from the account holder (checkout.userId). Per
  // ADR-0029, account-less roster members have no email; the account
  // holder is always the correct recipient (issue #471).
  const recipientEmail = await resolveRecipientEmail(checkout);
  if (!recipientEmail) {
    logger.warn(`Bill ${billId}: no recipient email, skipping`);
    return true; // Nothing to retry
  }

  // Template selection always reads the checkout's last paymentMethod.
  // Auto-ack on a user who tapped TWINT but didn't commit still uses the
  // TWINT-was-selected template (safe because it doesn't claim payment).
  const template = pickTemplate(checkout.paymentMethod ?? null, bill);

  // Acquire lock
  await billRef.update({ emailSentAt: Timestamp.now() });

  try {
    // Configured-template assertion runs after the lock so a thrown
    // misconfiguration goes through the catch block (lock released,
    // operations_log written, returns false). Without this, an unset
    // template id in prod would throw past trySendEmail and block any
    // downstream onBillUpdate work (membership activation).
    assertTemplateConfigured(template.id, template.paramName);

    const bucket = getStorage().bucket();
    const file = bucket.file(bill.storagePath);
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 24 * 3600 * 1000,
    });

    const invoiceNumber = formatBillReference(bill.referenceNumber, bill.kind);
    const recipientName = checkout.persons[0]?.name ?? "Kunde";
    const checkoutDate = formatWorkshopDateTime(
      checkout.created.toDate(),
      "dd. MMMM yyyy, HH:mm",
    );

    // Lazy import: same rationale as build_invoice_pdf above.
    const { Resend } = await import("resend");
    const resend = new Resend(resendApiKey.value());
    const { error } = await resend.emails.send({
      from: resendFromEmail.value(),
      to: recipientEmail,
      template: {
        id: template.id,
        variables: {
          RECIPIENT_NAME: recipientName,
          CHECKOUT_DATE: checkoutDate,
          INVOICE_NUMBER: invoiceNumber,
          AMOUNT: bill.amount.toFixed(2),
          CURRENCY: bill.currency,
          KASSE_EMAIL: kasseEmail.value(),
          CONFIRMATION_SOURCE: bill.paymentMethodConfirmationSource ?? "",
        },
      },
      attachments: [
        {
          path: signedUrl,
          filename: `${(bill.kind ?? "invoice") === "beleg" ? "Beleg" : "Rechnung"}-${invoiceNumber}.pdf`,
        },
      ],
    });

    if (error) {
      throw new Error(JSON.stringify(error));
    }

    logger.info(`Invoice email sent for bill ${billId} to ${recipientEmail}`);
    return true;
  } catch (error) {
    // Release lock on failure
    await billRef.update({ emailSentAt: null });
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Email send failed for bill ${billId}`, { error: message });
    await logOperationError("bills", billId, "email_send", message);
    return false;
  }
}

// --- Triggers ---

/**
 * Fast path: when a bill is created, generate the PDF so it (and the
 * SCOR reference) is ready by the time the user reaches Step 4. The
 * email no longer fires here — it's gated on the user acking the
 * payment method (see `onBillUpdate`).
 */
export const onBillCreate = onDocumentCreated(
  {
    document: "bills/{billId}",
    timeoutSeconds: 120,
    // PDF generation builds the full invoice Buffer in memory (pdfkit +
    // swissqrbill); 256 MiB is tight for non-trivial invoices.
    memory: "512MiB",
  },
  async (event) => {
    const billId = event.params.billId;
    if (!event.data?.data()) {
      logger.error(`onBillCreate: no data for bill ${billId}`);
      return;
    }
    await tryGeneratePdf(billId);
  },
);

/**
 * Ack trigger: when `paymentMethodConfirmationTime` flips from null to
 * set (either via the `acknowledgeBill` callable or the daily 03:00
 * cron), run the two gated side-effects — email + membership activation.
 * Both helpers are individually idempotent so this trigger firing twice
 * is safe.
 */
export const onBillUpdate = onDocumentUpdated(
  {
    document: "bills/{billId}",
    timeoutSeconds: 120,
    memory: "512MiB",
    secrets: [resendApiKey],
  },
  async (event) => {
    const billId = event.params.billId;
    const before = event.data?.before.data() as BillEntity | undefined;
    const after = event.data?.after.data() as BillEntity | undefined;
    if (!before || !after) return;

    // Sammelrechnung path (issue #245/#405): when acknowledgeBill /
    // autoAcknowledgeBills flip a bill to kind "beleg", regenerate the
    // PDF so the title reads "Beleg" / "Belegnummer:" instead of
    // "Rechnung", then email the Beleg to the member as a receipt for the
    // visit (issue #405 — a receipt, not a payable invoice). Membership
    // activation still waits for the monthly aggregation cron. trySendEmail
    // is idempotent (emailSentAt lock).
    const beforeKind = before.kind ?? "invoice";
    const afterKind = after.kind ?? "invoice";
    if (beforeKind !== "beleg" && afterKind === "beleg") {
      try {
        await tryGeneratePdf(billId, { force: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          `onBillUpdate: Beleg PDF regen threw for bill ${billId}`,
          { error: message },
        );
      }
      try {
        await trySendEmail(billId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          `onBillUpdate: Beleg trySendEmail threw for bill ${billId}`,
          { error: message },
        );
      }
      return;
    }

    if (before.paymentMethodConfirmationTime) return;
    if (!after.paymentMethodConfirmationTime) return;
    // Defensive: Belege never carry an ack stamp, but if one ever lands
    // (manual ops repair?) we still skip the email side-effects.
    if (afterKind === "beleg") return;

    // Regenerate the PDF so it reflects the user's chosen method
    // (#251). At create-time the PDF is built before the user picks a
    // method, which means rechnung gets the QR slip by default. For
    // TWINT / Sammelrechnung we don't want the QR slip in the PDF
    // (the user already paid via TWINT or it's going on the next
    // Sammelrechnung — they shouldn't see "pay this" again).
    // tryGeneratePdf with `force: true` overwrites the existing PDF.
    try {
      await tryGeneratePdf(billId, { force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `onBillUpdate: tryGeneratePdf regen threw for bill ${billId}, continuing with existing PDF`,
        { error: message },
      );
    }

    // Email + membership activation must be independent: a Resend
    // outage or template misconfiguration cannot block the user's
    // membership from landing. trySendEmail already swallows its own
    // failures (catch + operations_log + return false) but a thrown
    // exception is still possible — log it and continue.
    try {
      await trySendEmail(billId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `onBillUpdate: trySendEmail threw for bill ${billId}, continuing to membership activation`,
        { error: message },
      );
    }
    // Membership activation propagates errors so Firestore retries the
    // trigger; processMembershipForAckedBill is idempotent
    // (paymentCheckouts arrayUnion).
    await processMembershipForAckedBill(billId);
  },
);

/**
 * Scheduled retry: pick up bills where PDF generation or email sending
 * failed. Runs every 15 minutes, processes bills created in the last 24h.
 */
export const retryBillProcessing = onSchedule(
  {
    schedule: "every 15 minutes",
    secrets: [resendApiKey],
    timeoutSeconds: 120,
    // Same as onBillCreate — runs tryGeneratePdf which loads pdfkit.
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);

    const recentBills = await db
      .collection("bills")
      .where("created", ">", cutoff)
      .get();

    let pdfRetries = 0;
    let emailRetries = 0;

    for (const doc of recentBills.docs) {
      const bill = doc.data() as BillEntity;
      const billId = doc.id;

      // An email is due once the bill is committed: a real invoice carries
      // a payment-method ack stamp (#251); a Beleg is committed by its kind
      // transition and never gets that stamp, but still emails a visit
      // receipt (#405). trySendEmail re-checks both, so this is just the
      // retry gate. Free bills / missing recipients are handled there.
      const emailDue =
        (bill.kind ?? "invoice") === "beleg" ||
        !!bill.paymentMethodConfirmationTime;

      // Needs PDF: no storagePath, no active lock (or stale lock)
      if (!bill.storagePath) {
        const isLocked = bill.pdfGeneratedAt &&
          Date.now() - bill.pdfGeneratedAt.toMillis() < STALE_LOCK_MS;
        if (!isLocked) {
          pdfRetries++;
          const pdfOk = await tryGeneratePdf(billId);
          // Email retry is gated on commit; if not yet committed, the
          // cron / next ack click triggers the send via onBillUpdate.
          if (pdfOk && emailDue) {
            emailRetries++;
            await trySendEmail(billId);
          }
        }
        continue;
      }

      // PDF exists but email not sent — same commit gate.
      if (!bill.emailSentAt && emailDue) {
        emailRetries++;
        await trySendEmail(billId);
      }
    }

    if (pdfRetries > 0 || emailRetries > 0) {
      logger.info(`Bill retry: ${pdfRetries} PDF, ${emailRetries} email attempts`);
    }
  },
);
