## Summary

<!-- What changed and why, 1–3 bullets. Closes #… -->

Spec: <fill in>
<!-- One of:
       Spec: none — <why no rule in docs/spec/ is affected>
       Spec: MEM-3 (added), BIL-7 (changed), BIL-2 (retired)
     Checked by the Spec line workflow; see docs/spec/README.md. -->

Deploy: <fill in>
<!-- One of:
       Deploy: none — <why nothing has to be run around the deploy>
       Deploy: docs/deploy/2026-10-20-<slug>.md
     A step is needed when something must happen before or after the deploy,
     in order, that scripts/deploy.sh does not do: a migration or backfill
     (with its dry run), a data gate, a mail-contract publish, a console
     switch, a new secret. The standard order (functions, rules, hosting) is
     not a step. Checked by the Deploy line workflow; see docs/deploy/README.md. -->

## Test plan

<!-- What you ran, and what covers the change. -->
