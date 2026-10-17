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
     A step is a migration: something that must happen before or after the
     deploy, in order, that scripts/deploy.sh does not do — a migration or
     backfill (with its dry run), a data gate, a mail-contract publish, a
     config parameter or secret required from now on, a console switch. The
     standard order (functions, rules, hosting) is not a step. If a fresh
     installation needs something too, update docs/deployment-checklist.md
     here as well. Name exactly the step files this PR adds. Checked by the
     Deploy line workflow; see docs/deploy/README.md. -->

## Test plan

<!-- What you ran, and what covers the change. -->
