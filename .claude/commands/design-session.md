---
description: Interactive design session for an issue whose UI/flow is still open — clickable mockup variants, iterate with the human, then post the agreed design as an approved plan the workqueue implements.
---

# /design-session <issue>

The workqueue hands an issue over (label `claude-workqueue-design`) when the
open points are about *how the UI should look or flow* — which step comes
first, what the default is, what a dialog says and offers. Text questions are
a poor tool for that. In this session you and the human settle it by looking
at mockups, and you end by writing the result back to the issue as a plan the
next `/workqueue` run implements without asking again.

You can also run it on any issue (no label needed) when the human wants to
design something before it goes into the queue.

Issue: `$ARGUMENTS` (a number). If it is missing, ask for it.

## 1. Understand what is being decided

- `gh issue view <N> --json title,body,comments,labels` — read everything,
  including the workqueue's "Needs a design session" comment (open
  questions, the files it found, today's screenshots). Download and look at
  every image in the issue (`curl -sL -o …`, then Read).
- Read the components and routes involved, the ADRs they cite, and the
  e2e specs that exercise them (they show the real setup of each state).
- If the workqueue posted no screenshots of today's screens, capture them
  yourself: write a throwaway `web/apps/<app>/e2e/wq-issue-<N>.capture.ts`
  using `shot()` from `scripts/wq-capture/shot.ts`, run
  `scripts/wq-capture.sh <app> .wq-capture/issue-<N>/after` and look at the
  PNGs. Both are gitignored.

Then summarise for the human in a few lines: what has to be decided, the
constraints (kiosk vs. own device, German copy with "du", the existing
components, anything ADRs pin down), and the 2–3 directions you see. Ask
only what you cannot infer; propose rather than interview.

## 2. Mock it up

Build **clickable mockups** as an artifact (load the artifact skills first, as
the Artifact tool says; for a canvas-style design use its `design` type via
`quickstart`). Rules that make the mockups useful here:

- **Look like the app.** Reuse the real look: colours, fonts and radii from
  the app's Tailwind theme (`web/modules` styles), the header with logo and
  account menu, the step indicator, real German labels, realistic data
  (names, CHF amounts). A grey wireframe hides exactly the problems this
  session is for.
- **Variants side by side** when the human hasn't picked a direction yet:
  2–3, each labelled with its idea in one line ("A — auto-start with
  countdown", "B — confirm screen").
- **Every state reachable** by clicking, and also by URL hash
  (`#state=<name>`), so each state can be screenshotted later: empty,
  loading, error, the kiosk and the own-device version, mobile width where
  people use it on a phone.
- Flows are clickable from start to end, including the cancel/back path.

Share the link and let the human click through it. Iterate on what they say:
change the mockup, republish to the same artifact, and keep a short running
list of the decisions so far in the conversation.

## 3. Pin down the details

Before writing the plan, make sure these are decided (ask about any that
are not):

- the flow step by step, including cancel/back and what happens on timeout
- every state of each screen, and which one is the default
- the exact German copy of buttons, headings, dialogs, toasts
- kiosk vs. own device vs. admin differences
- edge cases the issue or the workqueue raised (second badge tap, open
  visit, missing data, …)
- what is explicitly **out of scope** for this issue
- the product rules this design establishes or changes, written as
  `docs/spec/` rules (one sentence each, see `docs/spec/README.md`) — the
  design's behaviour outlives its copy and mockups

## 4. Write it back to the issue

1. Screenshot the final mockup states for the plan. Save the artifact's
   HTML locally and render each state with Playwright, desktop and mobile
   where relevant:
   `npx playwright screenshot --viewport-size=1280,800 "file://<abs path>.html#state=<name>" .wq-capture/issue-<N>/after/desktop/<NN>-<name>.png`
   (`--viewport-size=375,812` into `…/after/mobile/`). Look at each PNG.
   Then publish:
   `npx tsx scripts/wq-media.ts <N> .wq-capture/issue-<N> --title "Entwurf"`
   (needs the workqueue App credentials in `~/.config/workqueue-app/env`; if
   they are missing, attach no images and say so).
2. Draft the plan comment in the workqueue's plan format, so the worker can
   implement it straight away:

   ```markdown
   <!-- claude-workqueue-plan -->
   ## Implementation plan (from design session)

   ### Understanding
   <what the issue asks, in 1–3 sentences>

   ### Design
   <the agreed flow step by step, states, defaults, exact German copy,
   kiosk/own-device differences, edge cases, out of scope>

   <media markdown from scripts/wq-media.ts>

   ### Approach
   <concrete changes: files, components, functions>

   ### Spec
   <the rules added, changed or retired, with id and exact text — or
   "none — <why>">

   ### Regression testing
   <unit tests for logic, e2e screenshot tests for the new screens, and
   which existing baselines will change>

   ### Risks / open questions
   <only what is genuinely still open; ideally nothing>
   ```

3. **Show the draft to the human and post it only after their explicit OK**
   (it is a public comment). Post with `gh issue comment <N> --body-file …`
   — as the human, since they approved it.
4. Hand it back to the queue:
   `gh issue edit <N> --remove-label claude-workqueue-design --remove-label claude-workqueue-plan-review --add-label claude-workqueue`
   The next `/workqueue` run sees an approved plan (marker present, no
   plan-review label) and implements it.
5. Clean up: delete `.wq-capture/` and any `*.capture.ts` you wrote.

Tell the human the comment link, and that the next workqueue run picks it
up. If they'd rather not put it in the queue (e.g. they want to build it
themselves), skip step 4's label change.
