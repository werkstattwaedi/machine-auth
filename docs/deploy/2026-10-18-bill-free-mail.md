---
phase: before-functions
---

# Publish the `bill-free` mail (#790)

**What:** From this release on, a checkout totalling CHF 0 (a visit,
Interne Nutzung, a CHF 0 purchase) gets its Beleg mailed once it is closed,
on a new contract mail, `bill-free` (dimension `kind`: visit / membership /
purchase; variables `RECIPIENT_NAME`, `CHECKOUT_DATE`, `INVOICE_NUMBER`).
Before, a CHF 0 bill sent no mail. The operations repo's change —
`email/src/mails/bill-free.ts` and its entry in `email/src/mails/index.ts`
— must be on its `main` (it builds on the `bill-paid-beleg` change of #763,
so that one goes first). Then publish to the environment being deployed,
from the operations repo (publish is additive; no `--prune` — nothing was
removed):

```bash
cd ../machine-auth-operations
npm run email:publish -- --env <staging|prod> --dry-run   # lists the three <env>-bill-free-* as new
npm run email:publish -- --env <staging|prod>
```

**Check:** the templates `<env>-bill-free-visit`, `-membership` and
`-purchase` exist in Resend (dashboard, or `resend templates list` per the
`resend-cli` skill). Already done when they do; a dry run then lists them as
unchanged.

**Without it:** every CHF 0 checkout's mail fails — Resend refuses a send to
a template alias that doesn't exist; the hourly retry keeps failing for 24 h
and the Beleg is never mailed. Nothing else breaks: the checkout closes and
the PDF is made either way.

**Note:** the hourly retry looks back 24 h, so CHF 0 bills created in the
day before this deploy get their Beleg mailed once, after the fact.

**Staging vs prod:** the same; staging first.
