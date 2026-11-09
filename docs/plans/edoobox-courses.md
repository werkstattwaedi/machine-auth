# edoobox courses: Kursleitung in the checkout (#842)

Status: **planned** 2026-11-09, design session on #842. Two PRs: the permission-grants prefactor (#843, Approach step 1), then the course feature (step 2). Meine Kurse for participants is the follow-up #844. Before the edoobox client is written, the API is probed on a trial edoobox account (see *Testing against edoobox*).

## Understanding
Course leaders («Kursleitung») manage their edoobox courses in the checkout, ideally at the kiosk together with the participants. They link each participant to a checkout account (an existing one or one created from the edoobox data), assign badges, record attendance (written back to edoobox), and close the course, which turns the participant's temporary permission into a permanent one or drops it. Course data is read live from edoobox. Only links, permission choices and the close are stored locally.

## Design

**Navigation (checkout).** The sidebar gets «Kursleitung» below a separator, shown only when the account is linked to an edoobox leader (admin, see below).

**Kursleitung (list).** Title «Kursleitung», subtitle «Deine Kurse aus edoobox». It lists only actionable courses: running ones (pill «Heute»), past the last Termin and not closed (pill «Abschliessen», gold), and upcoming ones. Closed courses are neither shown nor fetched. Each row shows a colour dot (Werkstatt colour), the title, «Sa 31.10. · Sa 7.11. · 7 Teilnehmende» and a chevron. Empty state: «Keine Kurse» / «Du leitest zurzeit keine laufenden Kurse.». If edoobox fails: banner «edoobox ist nicht erreichbar. Versuche es in ein paar Minuten nochmals.» with the button «Neu laden».

**Course page.** Back link «Kursleitung», title = course, subtitle «Sa 31.10. · Sa 7.11. · 9:00–12:00 · gibt «Lasercutter»», button «Kurs abschliessen» (from the start of the last Termin). Card «Teilnehmende», a table:
- *Teilnehmer:in*: name plus edoobox e-mail.
- *Anwesenheit*: group header with one column per Termin (header = date only; today's in teal). Doodle-style full cells: present = green with ✓, absent in the past = light red with ✗, today not yet set = hatched. A click toggles the cell and writes to edoobox immediately (toast «In edoobox gespeichert»). Future Termine are not clickable. Footer row «Anwesend» shows «6 / 7» per Termin.
- *Zugang*: three icons (Konto, Badge, Berechtigung). Done = green. The next open step = yellow filled, with the action in bold next to it: «Konto verknüpfen» / «Badge zuweisen» (on the teacher's own device: «Badge am Kiosk zuweisen»). Not reachable yet = grey dashed. Permission: Vorläufig = teal, Ja/already held = green, Nein = red. With Nein, no badge step is suggested. Tooltip/aria-label spells out the state.
- Chevron; a row click opens the person page.
- Mobile (<640 px): the Zugang icons + next step move under the name, the e-mail and the Zugang column are hidden, only the name + date cells remain.
- Closed: info banner «Abgeschlossen am Sa 7.11. Änderungen macht das Sekretariat.», everything read-only, no next-step text.

**Person page.** Back link to the course, name as the title, pager «‹ 2 / 7 ›» (icon buttons, aria-label with the name).
- *Not linked*: card «Konto», showing the edoobox e-mail with a pencil (edit → input + «Übernehmen» / «Abbrechen»; the correction is only used for matching and is not written back to edoobox). Status «Konto vorhanden» → button «Mit diesem Konto verknüpfen», or «Noch kein Konto» → «Konto anlegen und verknüpfen» (name + e-mail from edoobox). Below it: «Die Verknüpfung kann danach nur das Sekretariat ändern.». No badge tap by the participant needed.
- *Linked*: account card with the pill «🔒 Verknüpft» (unchangeable), then a card with:
  - *Badge*: «Vorhanden», or «Fehlt» + «Badge zuweisen» (kiosk) / «Am Kiosk zuweisen» (own device). «Badge zuweisen» opens a **dialog** with the ReaderScene animation from the login (`nfc-badge-affordance.tsx`, reuse it, don't copy it), «Neuen Badge an den Leser halten», «Der Badge gehört danach Luca Meier.», «Abbrechen». The badge is free and is registered directly to the linked account (no checkout). An already registered badge is refused.
  - *Berechtigung «Lasercutter»*: segmented «Nein / Vorläufig / Ja», description «Keine» / «Während der Termine» / «Dauerhaft». Default after linking: Vorläufig. Someone who already has the permission: pill «Schon berechtigt». Changes save immediately (toast «Gespeichert»), possible until the course is closed.

**Kurs abschliessen.** Title «Kurs abschliessen», subtitle «Wer «Lasercutter» behält». One row per participant with a Nein/Ja segmented control:
- Preset Ja for Vorläufig/Ja and for already permitted people (tag «Schon berechtigt», green, next to the name). Nein for choice Nein.
- No account: Nein fixed (greyed out), red tag «Kein Konto».
- Missed Termine: gold tag «An 1 Termin abwesend» / «Nie anwesend».
- On Nein, a field appears with the label «Grund (Notiz in edoobox)», prefilled with «Kein Konto», «Nicht teilgenommen» (absent from every Termin) or «Nicht an allen Terminen teilgenommen», otherwise empty. The reason goes to edoobox as a note (`POST /v2/note`, pinned to booking + offer + participant user).
- Footer «4 erhalten «Lasercutter»», «Abbrechen» / «Abschliessen». Toast «Kurs abgeschlossen».
- Ja grants the permission permanently. Nein never takes away a permission held before the course.

**Not closed.** Mail to the course leader 1, 3 and 7 days after the last Termin («Einführung Lasercutter» ist seit Sa 7.11. vorbei, aber noch nicht abgeschlossen. Bis dahin erhält niemand die Berechtigung für den Lasercutter.» + button «Kurs abschliessen»). On day 7 the office is also notified. The temporary permission ends regardless of the close.

**Admin.** Person page › Profil: card «Kursleitung», dropdown «edoobox-Leitung» (edoobox admins + «Keine»), check «3 Kurse in edoobox», «Speichern». One edoobox leader belongs to at most one account. The person page lists the person's course links with «Verknüpfung lösen». Permissions stay in the «Berechtigungen» tab. No admin course screen in this issue.

**Defaults decided in the session** (open questions from the spec review):
- Ja before the close behaves like Vorläufig; only the close grants permanently.
- Temporary windows (Termin start → end + 1 h) are stored with from/until, and the check-in compares them exactly. The daily job only keeps them up to date (Termine changed in edoobox, cancelled bookings).
- Nein during a Termin ends the temporary permission immediately.
- A course leader cannot grant themselves a permission through their own course (if they are a participant in it); the server refuses. Admins grant to anyone, themselves included.
- «Future Termine can't be set», «only participants of your own courses», «one link per participant» and «one account at most once per course» are enforced by the server, not just the UI.
- Kiosk limits stay as they are (2 min idle, 15 min step-up). The teacher taps their badge again.
- A participant cancelled in edoobox loses the temporary permission at the next daily run. The link stays.

**Out of scope:** «Meine Kurse» for participants (designed, see `15-profile`: «Kurse, die du besucht hast», per course a colour dot, the title, «dates · course leader», a pill with the outcome, a link «edoobox ↗» via `shareurl`, footer «Kurse buchst du auf werkstattwaedi.ch/kurse ↗»). It is the most widely seen page, so it ships in the follow-up #844; admin course view (close/reopen/relink a course); booking through our own accounts (it would make the explicit link unnecessary); writing e-mail corrections back to edoobox; edoobox webhooks (they don't exist).

## Entwurf

**Desktop**

| Screen | Nachher |
|---|---|
| `01-courses` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/01-courses.png" width="480"> |
| `02-course` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/02-course.png" width="480"> |
| `03-course-after` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/03-course-after.png" width="480"> |
| `04-course-closed` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/04-course-closed.png" width="480"> |
| `05-person-new` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/05-person-new.png" width="480"> |
| `06-person-edit` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/06-person-edit.png" width="480"> |
| `07-person-found` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/07-person-found.png" width="480"> |
| `08-person-badge` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/08-person-badge.png" width="480"> |
| `09-person-tap` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/09-person-tap.png" width="480"> |
| `10-person-ready` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/10-person-ready.png" width="480"> |
| `11-own` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/11-own.png" width="480"> |
| `12-close` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/12-close.png" width="480"> |
| `13-close-no` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/13-close-no.png" width="480"> |
| `14-reminder` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/14-reminder.png" width="480"> |
| `15-profile` (Meine Kurse, follow-up) | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/15-profile.png" width="480"> |
| `16-admin` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/16-admin.png" width="480"> |
| `17-empty` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/17-empty.png" width="480"> |
| `18-error` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/desktop/18-error.png" width="480"> |

**Mobil**

| Screen | Nachher |
|---|---|
| `01-course` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/mobile/01-course.png" width="260"> |
| `02-person-new` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/mobile/02-person-new.png" width="260"> |
| `03-person-tap` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/mobile/03-person-tap.png" width="260"> |
| `04-close-no` | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/mobile/04-close-no.png" width="260"> |
| `05-profile` (Meine Kurse, follow-up) | <img src="https://raw.githubusercontent.com/werkstattwaedi/machine-auth/f7796519a1eca98a24771d61aea3d1e4a0ecba43/issue-842/2026-11-08T13-21-41-484Z/after/mobile/05-profile.png" width="260"> |


Interactive mockup (final version): https://claude.ai/artifact/NgmGGAMBmjC5a7sPP1e8TT. Screen dropdown at the top. Ignore the A–D Zugang variants; E is the agreed one.

## Approach

**Step 1: prefactor, its own PR before the course feature.** `users.permissions` becomes a map of grants keyed by permission id instead of a list of refs:

```
permissions: {
  laser: {
    permission: <ref permission/laser>,
    grantedAt, grantedBy: <ref users/…> | null,
    source: "admin" | "course" | "legacy",
    course?: { offerId },          // set when a course granted it
    windows?: [{ from, until }]    // set = temporary; absent = for good
  }
}
```
- `@oww/shared`: `heldPermissionIds(user, now)` (an entry counts when it has no `windows` or `from ≤ now < until` for one of them) plus the `PermissionGrant` type. Every reader goes through it: `handle_terminal_checkin.ts`, `badge/shared.ts` (badge price rule), `web/modules/lib/auth.tsx`, checkout `account/profile.tsx`, admin `permissions-tab.tsx`, `overview-tab.tsx`, `machines/$machineId.tsx`, `permissions/index.tsx`, `permissions/$permissionId.tsx`.
- Admin grants move to a callable (`authCall` `grantPermission` / `revokePermission`, admin only), which stamps `grantedAt`/`grantedBy`/`source: "admin"`; an admin may grant to anyone, themselves included. The rules can't validate a map rewritten as a whole, so `permissions` becomes function-only for every client, admins included (pattern: `usageGroups`); self-create stays pinned to `{}`.
- The Berechtigungen tab shows per permission «seit 3.11.2026 · von Mike Schneider» (legacy entries: «vor Nov. 2026»).
- Account-creation paths (`create-user.ts`, `signup_kiosk.ts`, `accept_invite_new_account.ts`, `scripts/import-members.ts`) write `{}`; seed data, `web/modules/test/fixtures.ts` and the e2e setups follow; `firestore/schema.jsonc` + both entity types.
- Migration `scripts/migrate-permission-grants.ts` (`--dry-run` first): each ref → `{ permission, source: "legacy", grantedAt: null, grantedBy: null }`; idempotent (skips maps). Order: functions that read both shapes → migration → rules + hosting. Deploy step `docs/deploy/YYYY-MM-DD-permission-grants.md` (phase `after-functions`), checklist unchanged (a fresh install starts with `{}`). Optional: fill `grantedAt` for legacy entries from the audit trail, if it holds the grant writes; otherwise leave null.
- Spec (prefactor PR): first commit MAC-1..2 as is (below); then ADM-16 (added), and MAC-3 (added) with MAC-1 (changed) for the terminal's 4 h re-entry (decided 2026-11-09). `Spec: MAC-1..3 (added), MAC-1 (changed), ADM-16 (added)`.

**Step 2: the course feature (#842)**, on top of the prefactor.

**edoobox client** (`functions/src/courses/edoobox/`): `POST /v2/auth` (key/secret → token, cached per instance), header `edid`. Methods:
- `listLeaderDates(adminId)` (`GET /v2/date?admin=…`, fields offerdata)
- `getOffer(id)` (incl. `shareurl`)
- `attendanceView(dateId)` / `GET /v2/attendance/list/table` (participants + attendance)
- `setAttendance` (`POST`/`PUT /v2/attendance`)
- `listAdmins()`
- `createNote` (`POST /v2/note`, pinned booking/offer/user)

Secrets `EDOOBOX_API_KEY` / `EDOOBOX_API_SECRET`, param `EDOOBOX_ACCOUNT_ID`, office address `COURSE_OFFICE_EMAIL`. Wire them through `scripts/generate-env.ts` and `FUNCTION_SECRET_NAMES` in `scripts/port-block-secrets.ts`, otherwise the emulator hangs. Tests swap the API via `setEdooboxApiForTest` (pattern: `setWalleeApiForTest`).

**Callables:** new dispatcher `courseCall` (`functions/src/courses/dispatcher.ts`, export in `index.ts`, client via `rpcCallable(functions, "courseCall", …)`):
- `listMyCourses`, `getCourse(offerId)`: participants + attendance from edoobox, merged with local links/choices + account status (account exists by e-mail via `findUserDocByEmail`, badge present, permission held).
- `setAttendance`
- `checkParticipantEmail`, `linkParticipant({offerId, participantId, email, create})`: creates the account via `ensureAuthIdentity` (never `createUser`/`getUserByEmail` directly, ADR-0043).
- `assignCourseBadge`: kiosk tap, free, registers `tokens/{uid}` directly to the linked account; an already registered badge → error.
- `setCoursePermission`, `closeCourse({choices, reasons})`.
- Admin: `listEdooboxLeaders`, `setEdooboxLeader`, `unlinkCourseParticipant`.

Each course-leader callable checks: caller (or kiosk `actsAs` with step-up, `requireElevatedActsAs`/`callerUserRef`) has `users.edooboxLeaderId`, and that leader leads the offer in edoobox. Participant belongs to the offer. Writes only to the linked account. No self-grant. Course not closed. Termin not in the future.

**Data** (`firestore/schema.jsonc`):
- `users.edooboxLeaderId` (admin-written via callable; rules pin it for clients).
- `courseLinks/{offerId}_{participantId}` {user, offerId, participantId, choice: no|temp|yes, linkedBy, linkedAt}: doc id = uniqueness per participant; per-course uniqueness of the account in a transaction (query offerId + user). Admin-readable, otherwise function-only (the owner read comes with Meine Kurse).
- `courseCloses/{offerId}` {closedBy, closedAt, choices, remindersSent}.
- Temporary permissions are entries in `users.permissions` (prefactor) with `source: "course"`, `course.offerId` and `windows`. No separate field.

Register the new collections in the subject-data map (`functions/src/privacy/subject_data_map.ts`; the coverage test fails otherwise). Add cross-user negative tests to `web/modules/test/cross-user-rules.integration.test.ts` for `courseLinks`.

**Check-in:** no change beyond the prefactor; `heldPermissionIds(user, now)` already honours `windows`.

**Permission entries from a course:** linking with Vorläufig/Ja adds an entry with the course's windows (Termin start → end + 1 h), unless the person already holds the permission (then nothing is written: «Schon berechtigt»). Nein removes the entry only if `source == "course"` and `course.offerId` is this course; an entry from an admin or another course is never touched.

**Daily job** `syncCoursePermissions` (pattern `usage_groups/sync_usage_groups.ts`, early morning):
- for every offer with links that isn't closed and whose last Termin hasn't passed, read the Termine and rewrite the `windows` of its course entries (Termine moved in edoobox) for linked participants with choice temp/yes; remove the entry of a participant no longer booked;
- for an unclosed course past its last Termin, remove its course entries that still have windows (they are past anyway; keeps the map clean);
- send reminders 1/3/7 days after the last Termin if not closed, plus the office on day 7.
A Termin moved in edoobox on the same day is picked up the next morning; accepted.

New mails `course-close-reminder` and `course-close-office` as a Resend contract (`shared/src/email-contract.ts`, published from the operations repo before the functions deploy).

**Close** (`closeCourse`): one transaction. Ja → the course entry loses its `windows` (now for good, `grantedAt` = close, `grantedBy` = course leader), or a new entry with `source: "course"` if the participant had none; an entry held before the course stays as it is. Nein → remove this course's entry, never anyone else's. Write `courseCloses`. Then write notes to edoobox (best effort with retry; failure only logs a warning and shows the teacher a toast, it doesn't roll back the close).

**Checkout web** (`web/apps/checkout/src/routes/_authenticated/account/`): routes `courses.tsx` (Kursleitung list), `courses.$offerId.tsx`, `courses.$offerId.$participantId.tsx`, `courses.$offerId.close.tsx`. Components under `src/components/courses/`: `participants-table`, `zugang-status`, `attendance-cell`, `badge-assign-dialog` (uses `ReaderScene` from `checkout/nfc-badge-affordance.tsx`, export it), `close-row`. Nav entries in `account-menu.tsx` / `_authenticated.tsx` (separator before «Kursleitung»). Writes via `useAsyncMutation` (ADR-0025). Badge tap: route the kiosk bridge tap during the dialog to `assignCourseBadge` (`bridge-nfc-router.tsx` currently ignores taps under `/account/*`; add an exception only while the dialog is open).

**Admin web:** Profil tab of the person page: card «Kursleitung» (dropdown from `listEdooboxLeaders`, «n Kurse in edoobox»). List of the person's course links with «Verknüpfung lösen».

**Testing against edoobox:** staging uses its own edoobox account, never the real one. First a new trial account (10-day free test mode) to experiment with the API end to end: auth, a leader's dates (`GET /v2/date?admin=`), participants, attendance, notes, which actions send mails to participants. If that account can't stay (trial ends), check whether a staging folder in the real account keeps test offers off the public list (offers in Draft are not shown and only bookable by an admin); staging would then still never write to real offers. `EDOOBOX_ACCOUNT_ID` and the key are per environment, so staging simply points at the test account. A smoke-runbook scenario walks the course flow on staging.

**Deploy:** `docs/deploy/YYYY-MM-DD-edoobox-courses.md` (phase `before-functions`): create the edoobox API key in edoobox, set the secrets/params in both projects, publish the mail contract. Update `docs/deployment-checklist.md` for fresh installs.

## Spec
New files `docs/spec/machine.md` (prefix `MAC`) and `docs/spec/courses.md` (prefix `CRS`), plus rows in the README's «Files» table:
- `MAC` | machine.md | the machine terminal: unlocking a machine, permissions
- `CRS` | courses.md | edoobox courses: course leaders, participants, attendance, temporary and granted permissions

**As is** (first commit of the prefactor PR, `docs/spec/` only). Already covered: MEM-14 (first badge free with a permission), BIL-34 (badge active at the close), ACC-4/ACC-5 (kiosk step-up), KIO-6 (taps in the account do nothing), KIO-7 (account idle 2 min). New:
- **MAC-1** A machine terminal unlocks a machine only for a badge whose account holds every permission the machine requires, an admin's account included; a machine that requires none asks for none. — #154
- **MAC-2** Only an admin grants or removes a person's permissions, and a granted permission holds until an admin removes it.

**Change in the prefactor:**
- **ADM-16 (added)** The Berechtigungen tab of a person's page shows, for each permission they hold, when and by whom it was granted and whether it came from a course. — #842
- **MAC-1 (changed)** A machine terminal unlocks a machine only for a badge whose account holds every permission the machine requires, an admin's account included, except a badge it lets in again under MAC-3; a machine that requires none asks for none. — #154, #843
- **MAC-3 (added)** For up to 4 h after the server let a badge in at a machine terminal, that terminal lets the same badge in again without asking the server, so a permission the account stops holding in that time (MAC-2) still unlocks the machine there. — #843

**Change in #842:**
- **MAC-1 (changed)** A machine terminal unlocks a machine only for a badge whose account holds every permission the machine requires — for good (MAC-4) or temporarily from a course (CRS-11) — an admin's account included, except a badge it lets in again under MAC-3; a machine that requires none asks for none. — #154, #842, #843
- **MAC-2 (retired)** — #842 (course leaders now grant too; replaced by MAC-4)
- **MAC-3 (changed)** For up to 4 h after the server let a badge in at a machine terminal, that terminal lets the same badge in again without asking the server, so a permission the account stops holding in that time — removed (MAC-4) or a temporary one past its window (CRS-11) — still unlocks the machine there. — #843
- **MAC-4 (added)** A person's permission is granted for good by an admin, to anyone including themselves, or by the close of a course (CRS-14); it is removed only by an admin and holds until removed. — #842
- **CRS-1** Only an account linked to an edoobox leader (ADM-17) sees Kursleitung in the account and can read or act on courses there; the server refuses everyone else. — #842
- **CRS-2** Kursleitung lists the courses the course leader leads in edoobox that are upcoming, running, or past their last Termin and not yet closed; a closed course is not listed. — #842
- **CRS-3** A course page shows the course — Termine, participants, attendance — as it is in edoobox when the page opens; besides edoobox, only a participant's link to an account, the permission choices and the close are kept. — #842
- **CRS-4** The course page lists the participants with their attendance per Termin, which the course leader sets to present or absent and which is written to edoobox; the server refuses setting a Termin that has not started. — #842
- **CRS-5** For each participant the course page shows whether they have a linked account, a badge and the course's permission, and names the next step — linking an account, else assigning a badge, no badge step while their permission choice is Nein. — #842
- **CRS-6** A participant without a linked account shows their edoobox e-mail, which the course leader can correct for matching only (edoobox keeps its address), and whether an account with that e-mail exists; the course leader links that account, or creates one from the edoobox data and links it, without the participant tapping a badge. — #842
- **CRS-7** Once linked, only an admin can change a participant's account (ADM-18); the server refuses linking a participant twice and linking one account to two participants of the same course. — #842
- **CRS-8** The server lets a course leader link an account only for a participant of a course they lead, and assign a badge or change a permission only for that participant's linked account, never their own. — #842
- **CRS-9** Assigning a badge at the kiosk waits for a tap and registers an unregistered badge to the participant's linked account for free, without a checkout; a registered badge is refused; on an own device the course leader is told to assign it at the kiosk, and nothing is assigned. — #842
- **CRS-10** Each linked participant has a permission choice — Nein, Vorläufig or Ja, Vorläufig once linked — which the course leader changes, saved at once, until the course is closed; Ja acts like Vorläufig until the close, and a participant who already holds the permission is marked as such. — #842
- **CRS-11** While a participant's choice is Vorläufig or Ja and they are booked on the course, they hold the course's permission temporarily, from the start of each Termin until 1 h after its end and at no other time, whether or not the course is ever closed; a change to Nein ends it at once. — #842
- **CRS-12** From the start of the last Termin the course leader can close the course, choosing Ja or Nein for each participant; missed Termine and "already holds the permission" are shown beside each one, and the choice starts as: no linked account → Nein, can't be changed; already holds the permission, or choice Vorläufig or Ja → Ja; choice Nein → Nein. — #842
- **CRS-13** A Nein at the close carries a reason, prefilled by the case (no account, absent from every Termin, absent from some), which is saved as a note on the participant's booking in edoobox. — #842
- **CRS-14** The close grants each participant with Ja the permission for good (MAC-4) and never removes a permission a participant held before the course. — #842
- **CRS-15** After the close, the course leader can no longer change anything on the course; changes go through an admin. — #842
- **CRS-16** While a course is not closed after its last Termin, its course leader is e-mailed a reminder 1, 3 and 7 days after that Termin, and on the 7th day the office is e-mailed too. — #842
- **ADM-17 (added)** An admin links a person to an edoobox leader, or removes the link, on the Profil tab of the person's page in the admin app; an edoobox leader is linked to at most one person. — #842
- **ADM-18 (added)** An admin removes a participant's link to an account on the person's page in the admin app. — #842
- **KIO-6 (changed)** last row: `| someone is in the account | the tap does nothing, unless a badge assignment waits for it (CRS-9) |`
- **KIO-13 (changed)** new row: `| someone is in the account | nothing, unless a badge assignment waits for it (CRS-9) |`
- Glossary: «Account» gains Kursleitung. New entries: Course (*Kurs*), Termin, Course leader (*Kursleitung*), Participant, Permission (*Berechtigung*), Temporary permission, Closed course.

Spec lines: prefactor `Spec: MAC-1..3 (added), MAC-1 (changed), ADM-16 (added)`; #842 `Spec: MAC-1 (changed), MAC-2 (retired), MAC-3 (changed), MAC-4 (added), CRS-1..16 (added), ADM-17..18 (added), KIO-6 (changed), KIO-13 (changed)`. CRS-17 (Meine Kurse) comes with the follow-up.

## Regression testing
- **Prefactor:** `heldPermissionIds` unit tests (no windows, inside/outside a window, legacy); `grantPermission`/`revokePermission` (admin only, self-grant allowed, stamps); rules: `permissions` not client-writable, admins included, self-create `{}`; migration dry run + idempotence; check-in and badge price rule unchanged with migrated data. Baseline that changes: admin Berechtigungen tab (grant line).
- **Functions unit (mocha):** edoobox client against a fake; permission guards of each callable (foreign course, foreign participant, second link, account twice per course, self-grant, closed course, future Termin); course entries (link adds windows, Nein removes only this course's entry, «Schon berechtigt» writes nothing); `closeCourse` (Ja drops the windows, Nein leaves admin and other-course entries alone, notes failure does not roll back); job (windows, cancelled booking, reminder days 1/3/7 + office).
- **Rules integration:** `users.edooboxLeaderId` not client-writable (admins included); `courseLinks` admin-read only; cross-user matrix.
- **Web unit:** Zugang state derivation (next step, Nein suppresses badge), close-page presets and prefilled reasons.
- **E2E screenshots (desktop + mobile):** Kursleitung list, course page (live/after/closed), person page (not linked/linked/badge dialog), Kurs abschliessen, admin Profil card. edoobox faked via the test hook in the emulator.
- **Baselines that change:** the checkout sidebar («Kursleitung» only appears for a linked leader, so existing baselines should stay; check `profile`/`usage`/`membership`), and the admin person Profil tab (`users-screenshots` `person-overview`) because of the new card. Regenerate through the `update_snapshots` dispatch, not locally.

## Risks / open questions
- edoobox write limit of 1,000/24 h: attendance clicks + notes are far below it, but don't write attendance per click without a debounce.
- The edoobox trial account may expire before the feature is done; then the folder approach in the real account (see Testing against edoobox) has to be checked first.
- Access to a leader's courses: `GET /v2/date?admin=` with our API key (account context) assumed. If edoobox only gives a leader their Termine in the leader context (`/v2/admission/*`, `trainerToken`), the client changes; check this first on the trial account.
