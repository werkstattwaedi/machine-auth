# ADR-0046: Mail Templates Generated from Code, Published to Resend

**Status:** Accepted

**Date:** 2026-10-12

**Applies to:** `shared/src/email-contract.ts`, `functions/src/util/resend_template.ts`, `functions/src/invoice/bill_triggers.ts`, every caller of `sendTemplate`, `scripts/generate-env.ts`, and `email/` in the operations repo

## Context

The functions sent 11 transactional mails as Resend templates. Each was a hand-written HTML file in the operations repo, uploaded with the Resend CLI, and selected through one `RESEND_*_TEMPLATE_ID` param per template.

Resend templates only substitute `{{{VARIABLES}}}`. They have no conditionals. So whenever the wording depended on data, the function pre-built the sentence and passed it in (`PAYMENT_NOTE`, `CORRECTION_DETAILS`, `DOCUMENT_KIND`, `GREETING`), and the grammar of one sentence ended up split across two repos. Issue #660 (a membership or badge purchase mailed as "Danke für deinen Besuch") would have needed three more such variables, or a template per combination of checkout kind and payment document. Copy changes were also hard to test: about 90 % of every file was the same shared layout, copied by hand into each one, and staging and prod sent the *same* templates, so a `templates publish` went live in prod with no staging check first.

## Decision

1. **Mails are TypeScript, in the operations repo.** A shared `layout()` holds the chrome; each mail provides subject, preheader, body and an optional text part. A generator renders **one template per combination of the mail's build-time dimensions**, and a publish script creates, updates and publishes the templates through the Resend SDK. Conditional wording is a build-time `if` on a dimension. Only free-form values stay send-time variables.
2. **The contract lives here, in `@oww/shared` (`email-contract.ts`).** It lists every mail with its dimensions and its exact variable list. The functions send through `templateAlias(env, mail, dims)` with exactly those variables (`contractVariables` picks them; tests assert the set). The generator imports the same file from the sibling checkout and refuses to publish a template whose placeholders differ. Resend rejects a send that misses a declared variable, so the two sides must match exactly, and each side checks it on its own CI.
3. **Aliases are `<env>-<mail>[-<dim>…]`.** There is no per-template config: the 11 `RESEND_*_TEMPLATE_ID` params are gone, and one `RESEND_TEMPLATE_ENV` (`prod` / `staging`, from `functions.resendTemplateEnv`) selects the environment. Staging and prod publish separate templates.
4. **No payment-method id in an alias.** Bill mails are keyed by *document*: `invoice` / `receipt` / `beleg` / `sammelrechnung`, from `billDocument()`, which reads `PAYMENT_METHOD_INFO` properties (ADR-0044). A new payment integration adds no template. Brand names are send-time variables.
5. **Publishing is additive.** Publish both environments, then deploy functions, then `--prune` the aliases nothing uses any more. A copy-only change is a publish with no functions deploy.

## Consequences

**Pros:**
- Wording can branch on data without pre-built sentences or one hand-maintained file per variant. The shared layout is edited once.
- Staging gets its own templates, so the staging smoke run reads a copy change before prod does.
- Mismatched variables are caught at publish time (operations) and in the functions tests (here), not by a failed send in prod.
- New payment methods (Wallee) need no template work.

**Cons:**
- The two repos are coupled through the sibling checkout. The operations generator needs `../machine-auth` present, and a contract change must be published before the functions deploy.
- Combinations multiply: every dimension multiplies the template count. Only small, fixed choices may become dimensions.
- Each published template carries its own copy of the layout (Resend has no partials). A chrome change is a republish of every template, done by one command.
- Editing a template in the Resend dashboard is pointless; the next publish overwrites it.

**Tradeoffs:**
- *Hand-written hosted templates plus more pre-built variables:* no new tooling, but it keeps spreading the grammar of one sentence across two repos, and nothing checks the variables.
- *Rendering mails at send time (React Email / `@react-email/render`, sending `html`):* real conditionals, but every copy change needs a functions deploy, it adds a render dependency to the functions, and the templates disappear from Resend. React Email's "upload to Resend" renders once at upload time, so it gives no more than this generator.
- *One template per payment method:* simplest selection, but it grows with every integration, and ADR-0044 deliberately avoids comparing method ids.
- *Contract in the operations repo:* keeps everything private, but machine-auth CI cannot clone that repo, so the functions side could not be checked.
