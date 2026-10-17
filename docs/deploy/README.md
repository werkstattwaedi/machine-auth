# Deploy steps

A deploy step is something that has to be done by hand around a deploy, in
a fixed order: a data migration or backfill, a data gate, a one-time console
switch, a template publish. Each one is a file in this directory, next to the
code that needs it, written for the agent that will carry it out
([ADR-0049](../adr/0049-deploy-steps.md)).

`scripts/deploy.sh` reads this directory. A step is **pending** for an
environment when its file was added or changed since that environment's
last deploy (its `deploy/<env>/firebase/*` tag, ADR-0045); an environment
with no deploy tag yet gets every step. At each phase boundary the script
stops, hands the pending files to an interactive agent session, and asks
once whether they are done before it continues. Files are never deleted:
this directory is also the history of every migration, and a new
installation gets the whole list in order.

## When a change needs a step

Ask: does something have to happen before or after this deploy, in order,
that the deploy script does not do? Then write a step. Typical cases:

- a data migration or backfill script (`scripts/migrate-*.ts`,
  `scripts/backfill-*.ts`), with its dry run;
- a data gate — a check that must pass before the new code is safe;
- a change to the mail contract (`shared/src/email-contract.ts`): the
  templates must be published from the operations repo first;
- a switch in a console (Firebase Auth providers, IAM, an alert policy);
- a new `defineSecret` that must have a value before the functions deploy.

Not a step, because the deploy does it every time: the BigQuery schema
(`setup-bigquery.ts` runs before every functions deploy), indexes and rules
(they ship with the deploy), config params (change the operations config,
`generate-env` runs at deploy time). The standard order — functions, then
rules, then hosting — is also not a step; a PR that only relies on it says
`Deploy: none — standard order`.

## The file

`docs/deploy/YYYY-MM-DD-<slug>.md` — the date it was written, a slug that
says what it does. Keep the name once it is merged.

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
2. **How to check it worked — and how to tell it was already done.** This
   matters more than it looks: a step is presented to every environment,
   and again whenever its file changes after it ran. The agent checks
   before it acts, so say what "done" looks like (a config doc exists, a
   script refuses to run twice, a count is zero).
3. **What breaks without it**, so the agent can tell a harmless skip from a
   dangerous one.
4. **Staging vs prod**, if they differ — e.g. "staging has no legacy bills:
   nothing to do there".

Write it as you would for a colleague who has the repo and the credentials
but was not in the PR. Link the ADR or issue.

## How it is carried out

`scripts/deploy.sh <env>` runs `scripts/deploy-steps.ts list` at each
boundary. With pending steps and a terminal it starts

```bash
claude "<prompt from: npx tsx scripts/deploy-steps.ts prompt --env prod --phase before-functions --project oww-maco --version …>"
```

— the prompt names the environment, the project, the release and the files,
and tells the agent to check first, dry-run before anything that changes
production data, record each step with
`npx tsx scripts/deploy-record.ts event --env <env> --note "deploy step <file>: …"`,
and stop when done. When the session ends, the script asks
"All <phase> steps done for <env>? [y/N]" and continues on yes. `--yes`
does not answer this question. With `--no-agent`, without a terminal, or
when `deploy.sh` runs inside a Claude Code session, the files are printed
instead and the same question is asked — the outer agent reads them.

Declining at `after-deploy` leaves the deploy **unrecorded on purpose**:
the tag does not move, so the step comes back at the next deploy. Finish
the step, then record by hand
(`npx tsx scripts/deploy-record.ts deploy --env <env> --component firebase`).

Preview what the next deploy would stop for:

```bash
npx tsx scripts/deploy-steps.ts list --env prod            # all phases
npx tsx scripts/deploy-steps.ts list --env staging --phase before-functions
```

## The PR

Every PR description has exactly one `Deploy:` line, checked by the
`Deploy line` workflow (`scripts/check-deploy-line.ts`):

```
Deploy: none — standard order, no data change
Deploy: docs/deploy/2026-10-20-migrate-bill-numbers.md
```

The files it names must be the step files the PR adds or changes, with a
header that parses. Whether `none` is true is the reviewer's judgement.
