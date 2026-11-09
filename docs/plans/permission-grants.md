# Permission grants (#843) and minimum client version (#845)

Status: **planned** 2026-11-09. Prefactor for the edoobox courses (`edoobox-courses.md`, #842). Two PRs, deployable the same night:

1. **Client version gate** (#845): a minimum client version that forces old web apps to reload, plus a hint when a newer version is out. Needed so a data-shape migration can't leave open tabs running old code against new data.
2. **Permission grants** (#843): `users.permissions` becomes a map of grants with who/when/where, admin grants go through the server, one overnight migration.

## Why

- `users.permissions` is a list of refs. It can't say who granted a permission, when, or that a course granted it only for its Termine. #842 needs exactly that (temporary entries with time windows, turned permanent at the close).
- Changing the shape of a field that every web app reads breaks open tabs: today's `auth.tsx` does `data.permissions.map(...)`, which throws on a map. We have no way to make old clients reload. The kiosk reloads its webview after every session, but phones, desktops and the admin app keep running old code for days.

## PR 1: client version gate

### Behaviour
- **Reload hint.** Both apps compare their compiled `BUILD_VERSION` with the deployed `/version.json` (already served `no-cache`) on start, when the tab becomes visible again, and every 15 min. If they differ: a non-blocking banner «Eine neue Version ist verfügbar.» with the button «Neu laden». The kiosk shows no banner; it already reloads after every session.
- **Minimum version.** `config/clients.minVersion` (release string, e.g. `"2026.11.4"`, or absent). A client whose `BUILD_VERSION` is lower shows a blocking screen «Die App wurde aktualisiert» / «Bitte lade die Seite neu, um weiterzumachen.» / «Neu laden», and reloads by itself once if `/version.json` already reports ≥ `minVersion` (guarded in `sessionStorage`, so a CDN still serving the old build can't cause a reload loop). The kiosk behaves the same (it has no banner, but it does get the blocking screen).
- **Server side.** Every dispatcher call carries `clientVersion` in the envelope. `dispatchRpc` refuses calls from a client below `minVersion` with `failed-precondition` (`details.reason = "client-outdated"`); `rpcCallable` turns that into the blocking screen. A call without `clientVersion` (scripts such as the privacy CLI, clients from before #845) is not refused; only a reported version is checked. `"dev"` (emulator, tests) is never refused. Direct Firestore writes can't carry a version; the rules refuse the writes that matter (the field-level pins).
- `ping` stays unauthenticated and unversioned.

### Changes
- `@oww/shared` `release-version.ts`: `isBelowMinVersion(build, min)` (compares the release a build is based on; `"dev"`, unreadable or absent → false).
- `web/modules/lib/client-version.tsx`: `ClientVersionGate` (listener on `config/clients`, `version.json` polling, the banner and the blocking screen), mounted in both apps' root; a module-level `reportClientOutdated()` that `rpc.ts` calls.
- `web/modules/lib/rpc.ts`: add `clientVersion: BUILD_VERSION` to the envelope.
- `functions/src/rpc/dispatch.ts`: read `config/clients` (cached per instance for 60 s), refuse outdated clients.
- Typed ref `clientsConfigRef` + `ClientsConfigDoc` (`firestore-helpers.ts`, `firestore-entities.ts`), schema entry. Rules: `config/*` is already public-read, admin-write; nothing to change.
- `firebase.json` (both sites): `Cache-Control: no-cache` for the HTML (`source: "**"`), `public, max-age=31536000, immutable` for `/assets/**` (hashed by Vite). Without this, a reload can still get the old `index.html` from the browser cache for up to an hour.
- `scripts/deploy/set-min-client-version.ts --env <staging|prod> [--version <v> | --clear]` (ADC, prints before/after, records a `deploy-record.ts event`). Default version = the release being deployed.

### Tests
- Shared: version comparison (`2026.9.30` < `2026.10.2`, `dev`, missing).
- Functions: dispatcher refuses below min / missing version, lets `dev` and equal/higher through, cache.
- Web unit: provider states (banner on mismatch, blocking below min, single auto-reload, loop guard).
- E2E screenshot (checkout desktop + mobile): the blocking screen and the banner (set `config/clients` / stub `version.json` in the test).

### Spec
New file `docs/spec/apps.md` (prefix `APP`): APP-1 (hint at a new version), APP-2 (blocked below the minimum version), APP-3 (server refuses calls reporting an older version). No as-is commit (nothing existed). `Spec: APP-1..3 (added)`.

## PR 2: permission grants

### Data
```
users.permissions: {
  <permissionId>: {
    permission: <ref permission/{id}>,
    grantedAt: Timestamp | null,          // null = legacy
    grantedBy: <ref users/{uid}> | null,  // null = legacy
    source: "admin" | "course" | "legacy",
    course?: { offerId: string },         // #842
    windows?: [{ from, until }]           // #842: set = temporary
  }
}
```
The map key is the permission id; `permission` keeps the ref (CLAUDE.md: references, not paths). `course` and `windows` are only defined here (types, helper) and used by #842.

### Changes
- `@oww/shared` `permission-grants.ts`: `PermissionGrant` type, `heldPermissionIds(permissions, now)` (entry without `windows`, or `from ≤ now < until` for one window), `permissionGrantEntries(...)` for display. It also accepts the legacy array shape, so a terminal check-in between the deploy and the migration still works; that branch goes once both environments are migrated.
- Readers through the helper: `functions/src/auth/handle_terminal_checkin.ts`, `functions/src/badge/shared.ts`, `web/modules/lib/auth.tsx`, checkout `account/profile.tsx`, admin `permissions-tab.tsx`, `overview-tab.tsx`, `machines/$machineId.tsx`, `permissions/index.tsx`, `permissions/$permissionId.tsx`.
- Writes:
  - `authCall` `grantPermission({ userId, permissionId })` / `revokePermission({ userId, permissionId })`, admin only, transaction; grant stamps `grantedAt`/`grantedBy`/`source: "admin"`, is a no-op if held; admins may grant to anyone, themselves included.
  - Admin `permissions-tab.tsx` and `permissions/$permissionId.tsx` call them through `useAsyncMutation` instead of writing the doc.
  - Rules: `permissions` is pinned for every client, admins included (pattern `usageGroups`); self-create requires `{}`.
  - Account creation (`create-user.ts`, `signup_kiosk.ts`, `accept_invite_new_account.ts`, `scripts/import-members.ts`) writes `{}`.
- Berechtigungen tab: under each held permission «seit 3.11.2026 · von Mike Schneider»; without a recorded date: «seit unbekanntem Datum».
- `firestore/schema.jsonc`, `functions/src/types/firestore_entities.ts`, `web/modules/lib/firestore-entities.ts`, seed data, `web/modules/test/fixtures.ts`, checkout/admin e2e setups and helpers.
- Migration `scripts/migrate-permission-grants.ts --env <staging|prod> [--dry-run]` (ADC): every users doc whose `permissions` is an array → map with `source: "legacy"`, `grantedAt`/`grantedBy` null; already-maps skipped (idempotent); prints counts only (no names/e-mails). `grantedAt`/`grantedBy` come from the audit log (`audit_log`, collection "users": the last write that added the permission, and its `actorUid`); null where the log doesn't reach back.

### Rollout (overnight)
Step file `docs/deploy/2026-11-09-permission-grants.md`, phase `after-deploy`:
1. Normal deploy (functions → rules → hosting) of the release with both PRs.
2. `set-min-client-version.ts --env <env>` → every gated client reloads onto the new build; old calls are refused.
3. Migration `--dry-run`, then for real; check: zero array-shaped `permissions` left.
4. Spot-check: a machine check-in with a permission, the admin Berechtigungen tab.

Between 1 and 3 (minutes) the helper reads both shapes, so terminals keep working; admin grants are refused by the rules in that window, which is fine at night.

**Clients without the gate.** Today's clients don't know `minVersion`. If PR 1 ships before PR 2 (a day is enough for open tabs to pick it up), the migration night is fully covered. If both ship the same night, an old tab that is open at that moment breaks on the new data shape until it is reloaded by hand; the kiosk is safe (it reloads after every session). Preferred: PR 1 first.

Fresh installation: nothing to add to the checklist (accounts start with `{}`; `config/clients` absent = no minimum).

### Tests
- Shared: `heldPermissionIds` (no windows, inside/outside a window, legacy array, empty/absent).
- Functions: grant/revoke (admin only, non-admin refused, self-grant by admin allowed, stamps, idempotent, unknown permission refused); check-in and badge price rule with map data and with legacy array; migration (array → map, idempotent, counts).
- Rules integration: `permissions` not writable by owner, kiosk, admin; self-create with `{}` only; existing cross-user tests stay green.
- Admin e2e: `permission-grant.spec.ts` through the callables; Berechtigungen tab screenshot changes (grant line).

### Spec
- First commit, as is: MAC-1 (a terminal unlocks only for an account holding every required permission) and MAC-2 (only an admin grants or removes permissions; a grant holds until removed), new file `machine.md`.
- As is also: ADM-16 (where admins grant and remove permissions).
- Change: ADM-16 (changed): the Berechtigungen tab shows, for each permission, when and by whom it was granted where that is recorded. "Whether a course granted it" comes with #842.
- `Spec: MAC-1..2 (added), ADM-16 (added), ADM-16 (changed)`.

## Out of scope
- Course entries (`source: "course"`, `windows`) are only typed here; #842 writes them.
- Removing the legacy-array branch of the helper: a small follow-up once both environments are migrated.
- A maintenance screen ("Wartung"): not needed with the minimum version.
- Forcing an update of the kiosk's Electron shell (its own release channel).
