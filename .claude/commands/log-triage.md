---
description: Read, analyze and categorize Cloud Logging warnings/errors from both Firebase projects; file or update bugs in the private operations repo, and email only when something genuinely new appeared.
---

# /log-triage

Daily log triage. Designed to run from a long-running tmux pane via
`.claude/scripts/log-triage-loop.sh`; also safe to run interactively.

**Arguments:** `$ARGUMENTS` (optional; `--hours N` to widen the window,
`--dry-run` to analyze and report to stdout without filing issues or
sending mail).

## Why this exists

Client-triggerable failures log at `warn`, not `error`, so they never page
(see `functions/src/checkout/verify_tag.ts` for the rationale). That makes
warnings the place where real problems hide. A static grouped digest of
them proved useless — one post-deploy sweep produced 42 rows of noise —
because the judgment needed is *"is this new, is this yesterday's thing
again, does this need action"*. That judgment is the whole job here.

## Core rules

1. **Issues go to the PRIVATE operations repo only** —
   `werkstattwaedi/oww-maco-operations`. Log payloads carry `userId`,
   `tokenId`, bill ids and email addresses. `werkstattwaedi/machine-auth`
   is PUBLIC; never put log content there.
2. **Never open a second issue for a fingerprint that already has one.**
   Search first, always. A triage bot that duplicates is worse than no bot.
3. **Email only for genuinely new findings.** A recurrence updates its
   issue silently. A quiet run sends nothing and files nothing.
4. **Never edit `known-benign.json` yourself.** Propose additions in the
   run summary; a human reviews the diff. Silencing a log class is a
   deliberate act.
5. **Don't fix the bug.** Triage classifies and files. Implementation is
   the workqueue's job, or a human's.

## Phase 1 — fetch

```bash
npx tsx scripts/log-triage-fetch.ts --hours 24
```

Emits JSON: `window`, `benignRuleCount`, and a `reports[]` entry per
project with `groups` (actionable), `suppressed` (matched a known-benign
rule, counts only), `total`, `dropped` (message-less rows), `truncated`.

Each group carries a `fingerprint` — a stable hash of (severity, first
message line). That fingerprint is the dedup key for everything below.

If a report has an `error` field, the project was unreachable. Note it in
the summary and carry on with the other project; do not abort the run.

If `groups` is empty for every project: STOP. Write the signal file
(Phase 6) and exit. No issue, no mail.

## Phase 2 — classify

For each actionable group, decide one of:

- **benign** — provably cannot indicate a problem. Propose a
  `known-benign.json` rule in the summary (pattern + reason), don't file.
- **known** — an open issue already carries this fingerprint. Go to
  Phase 4.
- **new** — genuine, not yet tracked. Go to Phase 3.

What to weigh, beyond the message text:

- **Time shape.** Entries clustered in one narrow window are usually a
  single event (a deploy, a scan, one user's session). Entries spread
  evenly across hours are a recurring condition — those matter more.
  Compare `firstTimestamp`/`lastTimestamp` against `count`.
- **Service spread.** One message across many services is
  infrastructure-shaped. One message on one service is code-shaped.
- **Embedded identifiers.** Messages like
  `Bill <id>: no recipient email, skipping` produce a *different*
  fingerprint per id, so the same underlying bug looks like many groups
  and never accumulates a count. When you spot this, file ONE issue for
  the class, title it generically (no id in the title), and list the
  observed ids in the body. Record every contributing fingerprint in the
  marker line so later runs match any of them.
- **Is it still happening?** A group whose `lastTimestamp` is recent and
  whose count keeps climbing across runs is worth more than a one-off
  burst that stopped hours ago.
- **Did we just deploy?** Check `git log --since` and the revision names
  in the samples. A cluster that starts exactly at a deploy is a
  regression; say so explicitly in the issue.

Use `gcloud logging read` directly to pull more context for anything you
are unsure about — the fetch script's samples are a starting point, not
the whole record. Look at what happened immediately before and after.

## Phase 3 — file new findings

Search first:

```bash
gh issue list --repo werkstattwaedi/oww-maco-operations \
  --state all --search "log-triage <fingerprint>" --json number,title,state
```

Only if nothing matches, create it:

```bash
gh issue create --repo werkstattwaedi/oww-maco-operations \
  --title "<generic, id-free description>" \
  --label log-triage \
  --body "<body>"
```

The body MUST end with a marker line so future runs find it:

```
<!-- log-triage: fingerprints=<fp1>,<fp2> project=<project> -->
```

Body should carry: what the log says, when it started and whether it is
ongoing, how often and across which services, the concrete sample lines,
your assessment of the likely cause, and what you'd want someone to check.
Be honest about confidence — "I could not tell whether X or Y" is more
useful than a guess stated flatly.

Create the `log-triage` label once if it doesn't exist:
`gh label create log-triage --repo werkstattwaedi/oww-maco-operations --description "Filed by /log-triage" --color FBCA04`

## Phase 4 — update known findings

Comment on the existing issue ONLY when something changed materially:
the rate jumped, it spread to a new service, it stopped, or it started
again after being quiet. A comment saying "still happening, same rate" is
noise — skip it.

If a group's issue is CLOSED and the group is back, reopen it and comment
with the new occurrences.

## Phase 5 — notify

Send mail only if Phase 3 created at least one issue.

```bash
resend emails send \
  --from "OWW Log Triage <noreply@checkout.werkstattwaedi.ch>" \
  --to michael.schneider@werkstattwaedi.ch \
  --subject "[log-triage] <n> neue Befunde" \
  --text-file -
```

The API key comes from `RESEND_API_KEY`; the loop wrapper exports it from
`functions/.env.oww-maco`. Body: one short paragraph per new issue —
what it is, why it matters, and the issue link. Keep it to what someone
can act on from their phone. German, matching the rest of the ops mail.

If the send fails, do NOT fail the run — the issues are already filed and
are the durable record. Note the failure in the summary.

## Phase 6 — summary and signal

Print to stdout: window, per-project actionable/suppressed counts, what
you filed, what you updated, what you judged benign (with the
`known-benign.json` rules you'd propose), and anything you could not
classify confidently.

End your final message with the run verdict on its own line, exactly:

```
LOG_TRIAGE_VERDICT: <verdict>
```

| Verdict | Meaning |
|---------|---------|
| `clean`   | Nothing actionable. |
| `filed`   | New issues were created. |
| `updated` | Only existing issues were touched. |
| `error`   | The run could not complete (note why in stdout). |

The wrapper greps stdout for this to pick its next cadence. It's a printed
line, not a file write, so a headless run needs no filesystem permission
outside the repo — emit it even when you failed, so a broken run is
distinguishable from a crashed one.
