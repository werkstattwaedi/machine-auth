---
description: Walk the deployed STAGING apps as a visitor, member, kiosk user and admin — following the smoke runbook, looking at every screenshot — and report whether the deploy is fit for production.
---

# Staging smoke run (agent)

You are the tester. After a staging deploy, use the deployed apps the way real
people would and judge what you see. This is an **assessment by looking**, not
a list of assertions — there is deliberately no scripted smoke suite. You are
here for what works *and* for what nobody thought to check: an uninvited
dialog, a wrong name, broken layout, odd copy, an invoice that looks off.

## Where everything lives

The runbook, the tools and the mailbox credential are in the **private
operations repo**, a sibling of this one:

- `../machine-auth-operations/smoke/RUNBOOK.md` — **read it first and follow
  it.** Scenarios, what good looks like, what to check on every screen, the
  report format.
- `npm run agent -- …` (run from `../machine-auth-operations`) — your hands: a
  persistent browser driver (`open`, `goto`, `click`, `fill`, `look`), the
  smoke mailbox (`mail mark` / `mail show`), virtual badge taps (`tap`) and
  staging facts (`staging …`). `npm run agent -- help` lists everything.

If that directory does not exist, stop and say so — do not improvise a test
against staging without the runbook.

## How to work

1. `cd ../machine-auth-operations`. If `gcloud` is not on PATH, export
   `GCLOUD_BIN` (usually `~/google-cloud-sdk/bin/gcloud`). Then
   `npm run agent -- start` — note the run id, addresses and evidence dir.
2. Walk the scenarios in the runbook. **After every acting command, open the
   screenshot with the Read tool** — the outline tells you what you can click,
   only the image tells you whether the screen is right. Open rendered mails
   and invoice PDF pages too.
3. Take `mail mark` *before* every action that sends a mail.
4. When something fails, first decide whose failure it is — the app's, the
   deploy's (secrets, IAM, indexes), or your tooling's. Say which in the
   report.
5. Write `REPORT.md` into the evidence directory in the runbook's format, then
   `npm run agent -- stop`.
6. Give the user a short summary: verdict, the findings that matter, and the
   path of the report. Do not paste login codes, the kiosk bearer or mailbox
   credentials anywhere.

## Boundaries

- Staging only — the tools refuse the production project; never point
  anything else at production.
- The only destructive tool is `staging delete-auth`, for smoke accounts.
  Change nothing else on staging, and fix nothing in the code during the run:
  findings go into the report, fixes are a separate task the user asks for.
- Arguments: $ARGUMENTS (e.g. "only H and I", "include the mobile viewport").
  With none, run all scenarios. A full run is long — say so up front and
  report scenario by scenario rather than going silent.
- When the user answers one of your "is this intended?" questions, put the
  answer into the runbook's "Known facts" so no later run asks again.
