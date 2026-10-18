---
phase: after-functions
---

# Backfill `paymentMethod` and `document` on existing bills (ADR-0052)

**What:** Bills now store their committed `paymentMethod` and their
`document` (Rechnung / Sammelrechnung / Beleg / Quittung). The new functions
write both on every bill they mint or commit; older bills carry only the
legacy `kind` and are read through a fallback. Give them the fields, dry run
first:

```bash
FIREBASE_PROJECT_ID=<project-id> npx tsx scripts/backfill-bill-document.ts --prod --dry-run
FIREBASE_PROJECT_ID=<project-id> npx tsx scripts/backfill-bill-document.ts --prod
```

(ADC or `GOOGLE_APPLICATION_CREDENTIALS`.) The dry run prints how many bills
it would touch, grouped as `kind=… → document=… paymentMethod=…`. Expect
`kind=beleg → document=beleg paymentMethod=monthly`, `kind=invoice →
document=rechnung …`, `… document=sammelrechnung paymentMethod=rechnung`
for Sammelrechnungen and `… document=quittung paymentMethod=raisenow` for
earlier TWINT bills. Anything else (e.g. `kind=beleg` with another method)
is worth a look before the real run. Cost: about two writes and two reads
per bill (each write also fires the bill audit trigger); far inside the
daily quota for a few thousand bills.

**Check:** the script ends with `Gate passes.` — no bill without `document`,
every `kind: "beleg"` bill on an aggregated method. Already done when a dry
run reports `to backfill: 0` and the gate passes; the script is idempotent.

**Without it:** nothing breaks today — every reader falls back to the
legacy derivation. But the follow-up that moves `monthlyBillRun` from `kind`
to `paymentMethod` and drops the fallback (ADR-0052 step 2) must not ship
before this gate passes in both environments, or un-backfilled Belege would
never reach a Sammelrechnung.

**Staging vs prod:** the same; staging first.
