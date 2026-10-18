---
phase: before-functions
---

# No unconfirmed bill is left before the overnight auto-confirm goes (#757)

This deploy removes `autoAcknowledgeBills`, the 03:00 job that committed
bills nobody confirmed (old BIL-7). It also removes the `acknowledgeBill`
callable and the `onCheckoutClosed` / `onCheckoutCreatedClosed` triggers.
From this release on, every bill is minted committed: a close names its
method (BIL-44), and a renewal bill is committed when it is issued (MEM-24).
A bill that is still unconfirmed when the job disappears is never mailed,
and for a renewal its year is never added. This step is a data gate: the
count below must be zero before the functions deploy.

**What:** count the bills nobody has committed yet. This is read-only and
selects no personal fields:

```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://firestore.googleapis.com/v1/projects/<project-id>/databases/(default)/documents:runQuery" \
  -d '{"structuredQuery":{"from":[{"collectionId":"bills"}],"where":{"fieldFilter":{"field":{"fieldPath":"paymentMethodConfirmationTime"},"op":"EQUAL","value":{"nullValue":null}}},"select":{"fields":[{"fieldPath":"created"},{"fieldPath":"kind"},{"fieldPath":"paidVia"},{"fieldPath":"cancelledAt"},{"fieldPath":"source"}]}}}'
```

Ignore every result that is a Beleg (`kind: "beleg"`, committed by its
kind), free (`paidVia: "free"`) or cancelled (`cancelledAt` set). Whatever
remains is blocking.

**Check / already done:** done means zero blocking bills, nothing else. It
does not count as done just because the function no longer exists: if the
count is above zero after the deploy, use remedy B.

**If it is not zero:**

- **A, before the deploy (preferred):** run the old job once more, then
  count again. Confirm the job name first:

  ```bash
  gcloud scheduler jobs list --location europe-west6 --project <project-id> | grep -i autoack
  gcloud scheduler jobs run firebase-schedule-autoAcknowledgeBills-europe-west6 \
    --location europe-west6 --project <project-id>
  ```

  The job only picks up bills older than one hour (`AUTO_ACK_MIN_AGE_HOURS`).
  The usual leftover is a renewal bill from that morning's 04:00
  maintenance run, so before about 05:00 Zurich time wait an hour. The job
  logs `autoAcknowledgeBills: processed unconfirmed bills` with the count.
- **B, after the deploy:** commit each leftover bill by hand with the Admin
  SDK. On the bill, set `paymentMethodConfirmationTime` to now and
  `paymentMethodConfirmationSource: "auto"`. On its checkout
  (`bill.checkouts[0]`), set `paymentMethod: "rechnung"` if it is null; if
  the checkout names `monthly` and the account holder is an active member,
  set the bill's `kind: "beleg"` instead of the ack. This is what the old
  job did. `onBillUpdate` then generates the PDF, sends the mail and adds
  the membership year. Do a dry run first that only lists the ids it would
  touch, and record what was changed with `deploy-record.ts event`.

**Without it:** the leftover bill stays unconfirmed for good. It gets no
mail, so the person never sees the invoice, and a membership bought or
renewed on it never activates or extends.

**Deploying:** `firebase deploy --only functions` asks interactively
whether to delete `autoAcknowledgeBills`, `onCheckoutClosed` and
`onCheckoutCreatedClosed`. Answer yes; deleting a scheduled function also
removes its Cloud Scheduler job. A run without a terminal stops at that
prompt.

**Staging vs prod:** the same on both. Prod was already at zero on
2026-10-18, after the first night with the #761 checkout.
