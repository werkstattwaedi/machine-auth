# TWINT via RaiseNow — WIP Continuation Notes

Status: **server-side skeleton implemented, not yet tested with real RaiseNow**.

## What's done

### Architecture changes
- `generateInvoice` callable + `sendInvoiceEmail` callable removed from exports. Bill lifecycle is now fully server-driven:
  1. Client closes checkout → Firestore trigger `onCheckoutClosed` creates a bill with a sequential reference number (no PDF yet)
  2. `onBillCreate` enqueues a Cloud Task with a **2-min delay**
  3. If TWINT payment arrives first → `raisenowWebhook` sets `paidAt` → `onBillPaid` generates PDF (as paid) + sends receipt email
  4. Otherwise → 2-min task fires → `processBillTask` generates PDF + sends invoice email with QR bill
- Payment result screen shows a **single QR code** (combined Swiss QR Bill + TWINT via alternative scheme params lines 33-34) and **live-updates** to "Bezahlt" when webhook fires
- All payment config (IBAN, recipient, TWINT AV params) moved server-side. Client calls `getPaymentQrData` callable and renders the returned string — no payment knowledge in the frontend

### New files
- `functions/src/invoice/create_bill.ts` — Firestore `onUpdate` trigger on `checkouts/{checkoutId}`
- `functions/src/invoice/get_payment_qr_data.ts` — Callable returning the complete SPC-format QR payload string
- `functions/src/invoice/bill_triggers.ts` — `onBillCreate`, `onBillPaid`, `processBillTask`
- `functions/src/webhook/raisenow_webhook.ts` — HMAC-verified webhook receiver
- `functions/src/webhook/verify_hmac.ts` — HMAC-SHA256 with constant-time comparison

### Modified files
- `functions/src/index.ts` — wired new exports, removed `generateInvoice`/`sendInvoiceEmail`
- `functions/src/invoice/build_invoice_pdf.ts` — `av1`/`av2` on SwissQRBill data
- `functions/src/invoice/types.ts` — `twintAv1`/`twintAv2` on `PaymentConfig`
- `web/apps/checkout/src/components/checkout/payment-result.tsx` — full rewrite
- `web/apps/checkout/src/components/checkout/checkout-wizard.tsx` — pass `checkoutId`
- `scripts/generate-env.ts` — removed `VITE_IBAN`/`VITE_TWINT_URL`/`VITE_PAYMENT_RECIPIENT_*` from client, added `TWINT_AV1`/`TWINT_AV2` to functions, added `RAISENOW_WEBHOOK_SECRET`
- `docs/config.md` — updated env var docs
- `machine-auth-operations/config.jsonc` — `twintUrl` → `twintAv1`/`twintAv2`
- `machine-auth-operations/config.local.jsonc` — same + `raisenowWebhookSecret`

### Build/test status
- `cd functions && npm run build` ✅ clean
- `cd web && npm run build` ✅ clean (checkout + admin)
- `payment-result.test.tsx` ✅ 6/6 passing (rewritten with mocked firestore/functions)
- `usage.test.tsx` ❌ 5 pre-existing failures (unrelated to this work — fail on main too)
- `functions/src/ntag/sdm_crypto.test.ts` ❌ 6 pre-existing failures (unrelated)

## What's left to do

### 1. RaiseNow Hub setup (prerequisite for anything to work)

On the RaiseNow Hub dashboard:

1. **Downgrade TWINT plan** from "TWINT Zahlungen Plus" (2.5%) to standard "TWINT Zahlungen" (1.3%). Decision: we already identify users via checkout auth, so payer data from Plus is redundant.
2. **Get the alternative scheme parameters** for the TWINT QR extension:
   - Navigate to your TWINT QR solution → "Extend your QR invoice with TWINT"
   - Copy "Alternative scheme parameter 1" and "Alternative scheme parameter 2"
   - Put them in `machine-auth-operations/config.jsonc` as `web.twintAv1` / `web.twintAv2`
3. **Configure a webhook** in RaiseNow Hub:
   - Endpoint URL: `https://<region>-<project>.cloudfunctions.net/raisenowWebhook`
   - Subscribe to event: `rnw.event.payment_gateway.payment.succeeded` (verify exact event name)
   - Copy the HMAC secret → store in Firebase Secret Manager (see step 3 below)

### 2. Confirm RaiseNow webhook payload format

The webhook handler in `functions/src/webhook/raisenow_webhook.ts` has **TODO comments** at fields that need verification against real RaiseNow docs (the support site returns 403 to WebFetch, so couldn't confirm):

- `SIGNATURE_HEADER` — assumed `x-signature`; confirm actual header name
- `PAYMENT_SUCCEEDED_EVENT` — assumed `rnw.event.payment_gateway.payment.succeeded`
- Envelope shape — `req.body.event` vs `req.body.event_name`, `req.body.data` vs `req.body`
- SCOR reference field — assumed `data.reference` or `data.structured_reference`
- Amount format — assumed **decimal CHF** (not cents); line 138 does `Math.abs(expectedAmount - paidAmount) > 0.01`. If RaiseNow sends cents, divide by 100.

**To find the real format:** trigger a test payment via RaiseNow Hub's test mode, look at the webhook delivery logs (or use a temporary HTTP logger like webhook.site to capture the real payload).

### 3. Firebase Secret Manager

```bash
# Set the real HMAC secret from RaiseNow Hub (production)
firebase functions:secrets:set RAISENOW_WEBHOOK_SECRET

# For local emulator testing, the secret is already in functions/.env.local
# (generated from config.local.jsonc → functions.raisenowWebhookSecret)
```

### 4. Cloud Tasks queue (required for 2-min delayed PDF+email)

`onBillCreate` uses `CloudTasksClient` to enqueue a delayed task. The queue must exist before deployment:

```bash
gcloud tasks queues create bill-processing \
  --location=us-central1 \
  --project=oww-maco
```

**Emulator caveat:** Cloud Tasks does not run in the Firebase emulator. For local testing, either:
- Stub out the enqueue call and manually invoke `processBillTask` via `firebase functions:shell`
- Or test end-to-end against a dev Firebase project

### 5. Delete the old generate_invoice.ts / send_invoice_email.ts files

The files still exist but are no longer exported from `index.ts`. They should be deleted:

```bash
rm functions/src/invoice/generate_invoice.ts
rm functions/src/invoice/send_invoice_email.ts
# Check nothing else imports them:
grep -r "generate_invoice\|send_invoice_email" functions/src/
```

I did not delete them yet — leaving them visible in the git diff makes the split clearer for review, and it's a one-line delete to drop them later.

### 6. Firestore security rules

The `bills` collection write permissions need review. Currently `generateInvoice` (admin) wrote to bills; now the server trigger does it. Verify the rules allow server writes (admin SDK bypasses rules, so this should still work), and verify client reads still work for the usage page and the live-update listener on `PaymentResult`.

Look at `firestore/firestore.rules` for any `bills` collection restrictions.

### 7. Index `bills.referenceNumber` (for webhook lookup)

The webhook handler queries `db.collection("bills").where("referenceNumber", "==", n).limit(1)`. Single-field queries get auto-indexes in Firestore, so nothing to add in `firestore/firestore.indexes.json` — but verify at first query.

### 8. Update E2E screenshot tests

The payment result UI changed significantly (two QR codes → one, paid state added). Baselines in `web/apps/checkout/e2e/*.spec.ts-snapshots/` will fail. Update with:

```bash
firebase emulators:exec --config firebase.e2e.json \
  --only firestore,auth,functions \
  'cd web/apps/checkout && npx playwright test checkin-screenshots checkout-screenshots --update-snapshots'
```

Note: the new PaymentResult needs a bill to exist (via the `onCheckoutClosed` trigger) before the QR code shows. E2E tests may need to wait longer or mock the callable.

### 9. Write webhook unit tests

The plan called for `functions/src/webhook/raisenow_webhook.test.ts` covering:
- HMAC valid/invalid
- Non-payment event → 200 ignored
- Bill not found → 404
- Already paid → 200 idempotent
- Amount mismatch → 200 with error logged
- Happy path → 200 + bill updated

Didn't write these yet. Use `supertest` + `sinon` (both already in devDependencies).

### 10. Manual verification checklist

Once RaiseNow is configured and the code is deployed:

- [ ] Complete a checkout → verify bill appears in Firestore within ~1s
- [ ] Verify payment result shows single QR code (check the payload string decodes correctly in a QR reader)
- [ ] Scan QR with e-banking app → verify amount/IBAN/reference fields are correct
- [ ] Scan QR with TWINT app → verify it picks up the alternative scheme params
- [ ] Make a test TWINT payment → verify webhook fires, bill `paidAt` gets set, UI live-updates to "Bezahlt – Vielen Dank!"
- [ ] Verify TWINT-paid bill generates PDF with "paid" stamp and sends receipt email
- [ ] Wait out the 2-min delay without paying → verify unpaid PDF generated and invoice email sent
- [ ] Pay later after email was sent → verify PDF regenerates as paid and second email sent

## Context for continuation

The original plan file is at `~/.claude/plans/flickering-moseying-valiant.md`.

The answered design decisions from that session:
- **Single combined QR** (not two separate ones)
- **Mark bill as paid** on webhook (no extra notification logic beyond email already triggered by `onBillPaid`)
- **Downgrade TWINT** tier (standard, not Plus)
- **Auto-create bill on checkout close** (Firestore trigger, no admin involvement)
- **Cloud Tasks** for the 2-min delay (not a scheduled polling function)
- **No TWINT app deep-link** on mobile (RaiseNow doesn't make it easy; not worth the effort)
- **Server provides the complete QR payload string** (not just the data fields) — client has zero payment knowledge
