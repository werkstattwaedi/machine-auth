# Deploy steps

A deploy step is a **migration**: something that has to be done by hand
around a deploy, in a fixed order, to bring an environment that already
runs to the state a fresh installation reaches by following
[`deployment-checklist.md`](../deployment-checklist.md) — a data migration
or backfill, a data gate, a template publish, a config parameter that is
required from now on. Each one is a file in this directory, next to the
code that needs it, written for the agent that will carry it out
([ADR-0049](../adr/0049-deploy-steps.md)).

`scripts/deploy/deploy.sh` reads this directory. A step is **pending** for an
environment when its file was *added* since that environment's last deploy
(its `deploy/<env>/firebase/*` tag, ADR-0045). Every added step file is in
its PR's `Deploy:` line, so that is exactly the set of steps the changes
deployed since the last run declared. At each phase boundary the script
stops, hands the pending files to an interactive agent session, and asks
once whether they are done before it continues. Files stay: we know when
staging and prod ran a step, but another installation of this repo deploys
on its own schedule from its own tag and must still find every step it has
not run.

Three things follow from "added since":

- **Editing a step file triggers nothing.** A typo fix after the step ran
  is harmless. A step that must run again is a new file. Don't rename a
  merged file — a rename counts as adding it.
- **A fresh installation has nothing pending.** It has no deploy tag; it
  was built from the checklist and is up to date by definition. So a PR
  whose change also needs something on a fresh installation updates the
  checklist in the same PR: the step migrates, the checklist installs, and
  after the step both environments must match.
- **A file that every tag is past is inert.** It is presented to nobody
  and costs nothing, so there is no cleanup to remember. The deploy log
  (`deploys/log.jsonl`, ADR-0045) says when each environment ran it.

## When a change needs a step

Ask: does something have to happen before or after this deploy, in order,
that `scripts/deploy/deploy.sh` does not do? Then write a step. Typical cases:

- a data migration or backfill script (`scripts/migrate-*.ts`,
  `scripts/backfill-*.ts`), with its dry run;
- a data gate — a check that must pass before the new code is safe;
- a change to the mail contract (`shared/src/email-contract.ts`): the
  templates must be published from the operations repo first;
- a config parameter or secret that is required from now on: the step says
  so and checks it is present in the operations repo's config (we usually
  commit the operations repo together with the change, but that is a
  convention, and a separate installation has its own operations config);
- a switch in a console (Firebase Auth providers, IAM, an alert policy).

Not a step, because every deploy does it (the list, in order, is in
[`scripts/deploy/README.md`](../../scripts/deploy/README.md)): the BigQuery schema — `setup-bigquery.ts` runs before
every functions deploy; indexes and rules — they ship with the deploy;
`generate-env`. The standard order — functions, then rules, then hosting —
is also not a step; a PR that only relies on it says
`Deploy: none — standard order`.

## The file

`docs/deploy/YYYY-MM-DD-<slug>.md` — the date it was written, a slug that
says what it does.

```markdown
---
phase: after-functions
---

# Migrate bill numbers to the shifted format (ADR-0042)

**What:** …
**Check:** …
**Without it:** …
```

The header has one field, `phase`, with one of three values:

| `phase` | The deploy script stops … |
|---|---|
| `before-functions` | before the functions deploy |
| `after-functions` | after the functions deploy, before rules, indexes and hosting |
| `after-deploy` | after functions, rules and hosting, before the deploy is recorded |

The body is plain words for an agent. It needs:

1. **What to run**, with the exact commands. Write `<project-id>` where the
   project goes; the agent is told which project it is deploying to. Say
   when a dry run comes first and what its output should look like.
2. **How to check it worked — and how to tell it was already done.** A
   deploy that stops after the step ran (a declined later phase, a failed
   hosting deploy) leaves the tag where it was, so the step comes back
   next time. The agent checks before it acts; say what "done" looks like
   (a config doc exists, a script refuses to run twice, a count is zero).
3. **What breaks without it**, so the agent can tell a harmless skip from a
   dangerous one.
4. **Staging vs prod**, if they differ — e.g. "staging has no legacy bills:
   nothing to do there".

Write it as you would for a colleague who has the repo and the credentials
but was not in the PR. Link the ADR or issue.

## How it is carried out

`scripts/deploy/deploy.sh <env>` runs `scripts/deploy/deploy-steps.ts list` at each
boundary. With pending steps and a terminal it starts

```bash
claude "<prompt from: npx tsx scripts/deploy/deploy-steps.ts prompt --env prod --phase before-functions --project oww-maco --version …>"
```

— the prompt names the environment, the project, the release and the files,
and tells the agent to check first, dry-run before anything that changes
production data, record each step with
`npx tsx scripts/deploy/deploy-record.ts event --env <env> --note "deploy step <file>: …"`,
and stop when done. When the session ends, the script asks
"All <phase> steps done for <env>? [y/N]" and continues on yes. `--yes`
does not answer this question. With `--no-agent`, without a terminal, or
when `deploy.sh` runs inside a Claude Code session, the files are printed
instead and the same question is asked — the outer agent reads them.

Declining at `after-deploy` leaves the deploy **unrecorded on purpose**:
the tag does not move, so the step comes back at the next deploy. Finish
the step, then record by hand
(`npx tsx scripts/deploy/deploy-record.ts deploy --env <env> --component firebase`).

Preview what the next deploy would stop for:

```bash
npx tsx scripts/deploy/deploy-steps.ts list --env prod            # all phases
npx tsx scripts/deploy/deploy-steps.ts list --env staging --phase before-functions
```

## The PR

Every PR description has exactly one `Deploy:` line, checked by the
`Deploy line` workflow (`scripts/check-deploy-line.ts`):

```
Deploy: none — standard order, no data change
Deploy: docs/deploy/2026-10-20-migrate-bill-numbers.md
```

The files it names are exactly the step files the PR **adds**, with a
header that parses. A PR that edits a step file names nothing — nothing
will run. Whether `none` is true, and whether the checklist got its
fresh-install half, is the reviewer's judgement.
