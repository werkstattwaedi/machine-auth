# ADR-0049: Deploy Steps as Text, Carried Out by an Agent

**Status:** Accepted (implemented)

**Date:** 2026-10-17

**Applies to:** `scripts/deploy/deploy.sh`, `scripts/deploy/deploy-steps.ts`, `docs/deploy/`, `scripts/check-deploy-line.ts`, the PR template, `docs/deployment-checklist.md`

## Context

Some changes only work when something is done around the deploy, in a
fixed order, by hand:

- a new BigQuery column must exist before the functions that emit it go
  live — the stats export inserts with `skipInvalidRows: false`, so one
  unknown column fails the whole batch (`person_usage_types`, #605);
- a mail contract change must be published before the functions that use
  it (ADR-0046);
- the bill-number migration had to run right after the functions deploy
  and not before it (ADR-0042), the identity data gate right before
  (ADR-0043), the `visit_items` backfill after (ADR-0039 amendment).

Until now these steps lived in prose: sections of
`docs/deployment-checklist.md`, "Deploy order:" sentences in CLAUDE.md,
and PR descriptions ("Deploy: functions first, then hosting", #755).
`scripts/deploy/deploy.sh` knew none of them. Whoever deploys — a person or an
agent — has to remember which PRs merged since the last deploy carry one,
and deploys happen days after the merge, staging and prod at different
times. A missed step fails quietly or late (#756).

Two things are already in place. ADR-0045 tags every deploy per
environment (`deploy/<env>/firebase/<timestamp>`) and logs manual steps
(`deploy-record.ts event`), so "what came in since this environment's last
deploy" is a git question. And the staging smoke run (`/smoke-staging`)
showed that an agent following a prose runbook is the right executor for
work that needs judgement — dry-run first, read the output, decide.

The one constraint from the discussion of #756: no complicated machinery.
Nothing with confirmation records, environment matrices or a step
executor. The goal is only that no step is forgotten.

## Decision

**A deploy step is a migration, written as a Markdown file; the deploy
script hands the pending ones to an agent.**

1. **A step migrates an existing environment.** It brings an environment
   that already runs to the state a fresh installation reaches by following
   `docs/deployment-checklist.md`. The two must end up the same: a PR whose
   change also needs something on a fresh installation (a secret, a config
   document, a console switch, a required config parameter) updates the
   checklist in the same PR. The step migrates; the checklist installs.
   `docs/deployment-checklist.md` therefore stops carrying migration
   narratives — it describes how to build the current state, nothing
   historical.

2. **One file per step, next to the code:** `docs/deploy/YYYY-MM-DD-<slug>.md`
   (the date it was written; the slug says what). The only structure is a
   header line, `phase:`, with one of three values:

   | Phase | The deploy script stops … |
   |---|---|
   | `before-functions` | before the functions deploy |
   | `after-functions` | after the functions deploy, before rules, indexes and hosting |
   | `after-deploy` | after everything, before the deploy is recorded |

   The body is plain words written for the agent that will carry it out:
   what to run (with `<project-id>` placeholders), how to check it worked
   and how to tell it was already done, what breaks without it, and whether
   staging and prod differ. Conventions: `docs/deploy/README.md`.

3. **Pending = added since this environment's last deploy.** A step is
   pending for an environment when its file was *added* since that
   environment's last `deploy/<env>/firebase/*` tag. The `Deploy:` line
   check (decision 6) makes every added step file appear in its PR's
   `Deploy:` line, so this is exactly the set of steps the changes deployed
   since the last run declared — read from git, with no GitHub call at
   deploy time. Editing a step file afterwards (a typo fix) triggers
   nothing; renaming one counts as adding it, so merged files keep their
   name. An environment with no deploy tag is a fresh installation: it was
   built from the checklist and is up to date by definition, so nothing is
   pending. There is no other state: a successful deploy moves the tag, an
   aborted one does not.

4. **Step files stay.** We know when staging and prod ran a step; we do
   not know about an installation someone else runs from this repo, which
   deploys on its own schedule from its own tag and must still find every
   step it has not run. A file that every tag is past is inert, so keeping
   it costs nothing.

5. **The deploy script stops at each boundary with pending steps**
   (`scripts/deploy/deploy-steps.ts list`). On a terminal it starts an interactive
   `claude` session (`deploy-steps.ts prompt`) that names the environment,
   the project, the release and the files, and tells the agent to carry the
   steps out in order, to check first whether a step already ran (an
   earlier deploy may have stopped after it, leaving the tag in place), to
   dry-run and wait for a go before anything that changes production data,
   and to record each step with `deploy-record.ts event`. When the session
   ends, the script asks once whether the steps are done and only then
   continues. With `--no-agent`, without a terminal, or when the script
   itself runs inside a Claude Code session, it prints the files and asks
   the same question — the outer agent reads them. **`--yes` never answers
   that question.** Declining at the `after-deploy` boundary leaves the
   deploy unrecorded on purpose: the tag does not move, so the steps come
   back at the next deploy.

6. **Every PR says whether it needs one.** The PR description carries
   exactly one `Deploy:` line — `Deploy: none — <reason>` or
   `Deploy: docs/deploy/<file>.md` — checked by the `Deploy line` workflow
   (`scripts/check-deploy-line.ts`, same pattern as the `Spec:` line of
   ADR-0047): the files it names are exactly the step files the PR adds,
   and their headers parse. A PR that edits or deletes a step file names
   nothing, because nothing will run. Whether `none` is honest is the
   reviewer's call; the `code-reviewer` agent asks it.

7. **The idempotent step runs every time, without a file.** `deploy.sh`
   runs `scripts/deploy/setup-bigquery.ts` before every functions deploy. It is
   idempotent and quick (append-only columns, views updated in place), so
   the whole class of "column deployed before the table knew it" disappears
   without anyone remembering anything. It needs Application Default
   Credentials, and a failure stops the deploy. What every deploy does is
   listed, in order, in [`scripts/deploy/README.md`](../../scripts/deploy/README.md).

8. **Scope.** The gate lives in `scripts/deploy/deploy.sh` only. The gateway,
   kiosk and firmware deploys do not stop for steps — none has needed one
   so far; when one does, the same list and prompt apply with their own tag
   glob. The rollouts that predate this ADR are done in both environments:
   their migration sections leave the checklist and are not backfilled as
   files (they would be "added since the tag" for staging and prod and come
   up once more for nothing; their ADRs and git history keep the record).
   What a fresh installation needs from them — the bill-number format
   marker on `config/billing` — is in the checklist's install steps.

## Consequences

**Pros:**
- A step is written where the change is, in the PR that needs it, in the
  words of the person who understood it — and the deploy cannot proceed
  past it unnoticed.
- No bookkeeping beyond what ADR-0045 already keeps: the deploy tag is the
  only marker, and `deploys/log.jsonl` says when each step ran.
- The agent handles what a script cannot: a step that is already done, a
  step that is nothing to do for staging, a dry run whose output needs
  reading.
- The checklist stays an installation guide: a fresh environment and a
  migrated one are built to the same state, and nobody reads through
  finished migrations to find the step they need.

**Cons:**
- Every `deploy.sh` run now needs Application Default Credentials for the
  BigQuery setup and fails without them.
- A pending step costs an interactive agent session in the middle of the
  deploy; the person deploying stays at the terminal.
- A step that ran before a deploy was aborted is presented again at the
  next one. Its "how to check" paragraph makes that a quick no-op.
- The agent can run a destructive command. The session is interactive and
  the prompt demands a dry run and a go before the live run; that is the
  same trust model as the smoke run, not less.
- The check only sees files that exist. Forgetting to write one — or to
  update the checklist for a fresh installation — is caught by review, not
  by the workflow.
- `docs/deploy/` grows by one file per migration and is never pruned.

**Tradeoffs:**
- *Structured headers (environments, once-per-project) plus confirmation
  records in the deploy log, as #756 first proposed:* every field is
  something the agent reads from the prose anyway, and the confirmation
  record duplicates the deploy tag. Rejected as machinery.
- *Reading the `Deploy:` lines of the PRs merged since the tag at deploy
  time:* needs GitHub at deploy time and breaks when a description is
  edited after the merge. "Added since the tag" is the same set by
  construction, from git alone.
- *Pending = added or changed since the tag:* would re-run a step for a
  typo fix, and nothing in the file says whether an edit means "run again".
  A step that must run again is a new file.
- *A `run:` line the script executes itself:* the steps that matter most
  (migrations, data gates) need judgement between commands. An agent
  reading prose covers both kinds; a script covers one.
- *Detecting the BigQuery case by path (`functions/src/stats/schema.ts`
  changed since the tag):* running the idempotent script every time is
  simpler and cannot be wrong.
- *Presenting every step to a new environment:* a fresh installation must
  not need migrations; it follows the checklist and lands at the current
  state. Steps are for environments that already run.
- *Deleting a step file once it ran everywhere:* "everywhere" is only
  knowable for the environments we operate. Another installation of this
  repo would silently miss the step.
- *Backfilling the finished rollouts as files:* they would be presented to
  staging and prod once more for nothing, and the install state they left
  behind is in the checklist.
