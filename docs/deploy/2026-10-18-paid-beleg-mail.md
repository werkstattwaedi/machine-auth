---
phase: before-functions
---

# Publish the TWINT Beleg mail copy (#763, ADR-0052)

**What:** From this release on, a bill paid during the checkout (TWINT) is a
**Beleg** `BL-…`, no longer a Quittung `RE-…`. Its mail is still the
`bill-receipt` template (alias unchanged), but its copy said "Quittung". The
operations repo's change (`email/src/mails/bill-receipt.ts`: subject, intro,
card title "Beleg …"; `email/src/contract.ts` re-exports the renamed
`BILL_MAILS` / `BillMail` from `shared/src/email-contract.ts`) must be on its
`main`, then publish to the environment being deployed, from the operations
repo, as its `email/README.md` describes (publish is additive; no `--prune`
needed — no alias was added or removed):

```bash
cd ../machine-auth-operations
npm run email:publish -- --env <staging|prod> --dry-run   # lists bill-receipt-* as changed
npm run email:publish -- --env <staging|prod>
```

**Check:** the published `<env>-bill-receipt-visit` template's subject reads
"Beleg TWINT-Zahlung" (Resend dashboard, or `resend templates get` per the
`resend-cli` skill). Already done when it does.

**Without it:** TWINT customers get a mail titled "Quittung" with a PDF
titled "Beleg" and a `BL-` number — the mismatch #763 fixes. Sends still
work (the contract's variables are unchanged). If the operations repo still
imports `BILL_DOCUMENTS` / `BillDocument`, its generator fails to load the
contract — merge its PR first.

**Staging vs prod:** the same; staging first.
