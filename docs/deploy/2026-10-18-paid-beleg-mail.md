---
phase: before-functions
---

# Publish the `bill-paid-beleg` mail (#763, ADR-0052)

**What:** From this release on, a RaiseNow bill — a promise to pay made
during the checkout through RaiseNow's TWINT paylink, which nothing
confirms — is a **Beleg** `BL-…`, and the functions announce it with a new contract mail,
`bill-paid-beleg` (dimension `kind`: visit / membership / purchase). The
Wallee terminal's verified payment keeps its Quittung and `bill-receipt`.
The operations repo's change — `email/src/mails/bill-paid-beleg.ts`, its
entry in `email/src/mails/index.ts`, and `email/src/contract.ts` re-exporting
the renamed `BILL_MAILS` / `BillMail` from `shared/src/email-contract.ts` —
must be on its `main`. Then publish to the environment being deployed, from
the operations repo (publish is additive; no `--prune` — nothing was
removed):

```bash
cd ../machine-auth-operations
npm run email:publish -- --env <staging|prod> --dry-run   # lists the three <env>-bill-paid-beleg-* as new
npm run email:publish -- --env <staging|prod>
```

**Check:** the templates `<env>-bill-paid-beleg-visit`, `-membership` and
`-purchase` exist in Resend (dashboard, or `resend templates list` per the
`resend-cli` skill). Already done when they do; a dry run then lists them as
unchanged.

**Without it:** every RaiseNow checkout's mail fails — Resend refuses
a send to a template alias that doesn't exist; the hourly retry keeps
failing until the templates are published. The operations repo's generator
also fails to load the contract while it still imports `BILL_DOCUMENTS` /
`BillDocument`.

**Staging vs prod:** the same; staging first.
