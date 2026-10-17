# Deploy tooling

Everything that ships a release lives here: the deploy paths, the checks
they run first, the release naming and the deploy record. Run each script
from the repository root (`deploy.sh` changes there itself).

The one-off steps a single change needs around its deploy are not here.
They are text in [`docs/deploy/`](../../docs/deploy/README.md), carried out
by an agent ([ADR-0049](../../docs/adr/0049-deploy-steps.md)). This page
lists what *every* deploy does, and where those steps stop it.

## What `deploy.sh <env>` does, in order

`npm run deploy:staging` / `npm run deploy:prod` run `deploy.sh`, which
deploys functions, rules, indexes and hosting to one or both Firebase
projects. With both, staging always goes first. Every command passes
`--project`; the active `firebase use` alias is never changed.

Once per run:

1. **Checks.** `node` and the `firebase` CLI exist, the staging hosting
   targets are applied in `.firebaserc`, and leftover functions deploy
   state from an interrupted run (an `@oww/shared` tarball pin) is
   restored.
2. **Preflight** (`deploy-preflight.ts`, ADR-0045). Refuses unless
   machine-auth and the operations repo are on an up-to-date, clean
   `main`. `--allow-off-main` overrides it, and the record says so. The
   commit is captured here, so the record names what was deployed, not
   what is checked out at the end.
3. **Release** (`release.ts`, ADR-0045). A commit deployed before reuses
   its `vYYYY.M.N` tag; a new commit gets the next number after one
   confirmation, which for prod replaces "Deploy to PRODUCTION?". Every
   build below carries it as `BUILD_VERSION` (`build-version.ts`).
4. **`npm install`**, which also builds `@oww/shared`.

Then per environment:

5. **Confirm production** (prod only), unless the release question just
   asked it.
6. **generate-env** from the operations config; staging adds the
   `config.staging.jsonc` overlay (ADR-0034).
7. **BigQuery schema** (`setup-bigquery.ts`). Every time, so a new stats
   column exists before the functions that emit it. Idempotent, needs
   Application Default Credentials; a failure stops the deploy with
   nothing deployed.
8. ⏸ **One-off steps, `before-functions`.**
9. **Functions** (`deploy-functions.ts`). Packs `@oww/shared` into a
   tarball (`prepare-functions-deploy.ts`, the `firebase.json` predeploy
   hook, after lint and build), writes `functions/lib/build-info.json`,
   runs `firebase deploy --only functions`, and restores
   `package.json`/the lockfile even on failure (ADR-0027).
10. **Hooks check** (prod only). Fails if the staging-only test hooks
    `mintTestTap` or `uploadTestUsage` are deployed in production.
11. ⏸ **One-off steps, `after-functions`.**
12. **Rules and indexes**: `firebase deploy --only firestore,storage`.
13. **Hosting**, checkout and admin. The `firebase.json` predeploy hook
    builds the web apps; staging builds with `build:staging`, so a
    staging site never ships a prod-configured bundle.
14. ⏸ **One-off steps, `after-deploy`.**
15. **Record** (`deploy-record.ts`, ADR-0045). A `deploy/<env>/firebase/<timestamp>`
    tag plus a line in the operations repo's `deploys/log.jsonl`, from
    which its `STATE.md` is regenerated. Best effort: a failed record
    never fails the deploy, and it prints the command to record by hand.

### Where the one-off steps stop it

At each ⏸ the script asks `deploy-steps.ts` for the step files in
`docs/deploy/` that were **added** since this environment's last
`deploy/<env>/firebase/*` tag. An environment without a tag is a fresh
installation and has nothing pending. If any are pending, it hands them to
an interactive `claude` session, or prints them with `--no-agent`, without
a terminal, or inside Claude Code. Then it asks once whether they are done;
`--yes` never answers that.

A "no" stops the deploy, and how much is deployed depends on where:

| Phase | Stops | A "no" leaves |
|---|---|---|
| `before-functions` | after the BigQuery schema | nothing deployed |
| `after-functions` | after functions and the hooks check | functions deployed, rules and hosting not |
| `after-deploy` | after hosting | everything deployed but **not recorded**, so the steps come back next time |

Preview what the next deploy stops for:

```bash
npx tsx scripts/deploy/deploy-steps.ts list --env prod
```

Not covered by `deploy.sh`: the gateway and the kiosk (below), secret
rotation, custom claims, and the staging smoke run (`/smoke-staging`). See
[`docs/deployment-checklist.md`](../../docs/deployment-checklist.md).

## The other deploy paths

Each runs preflight, release and record like `deploy.sh`, with its own
component in the record. None of them stops for one-off steps yet.

- **Gateway** (`npm run deploy:gateway`, `deploy-gateway.ts`). Builds the
  Python payload with its protos, writes its `.env.local` and `VERSION`
  from the operations config and Secret Manager, and installs it on the
  Raspberry Pi over SSH. `--build-only` stops after the build.
- **Kiosk** (`npm run build:kiosk:staging|prod` in `checkout-kiosk/`,
  `deploy-kiosk.ts`). Builds the Windows installer with URL, bearer and
  version baked in. The installer is still installed on the kiosk PC by
  hand. `--dev` builds a local binary without preflight, release or record.
- **Firmware** (`./pw prod-flash`). Flashes the production firmware over
  USB and records the device id.

## Files

| File | Purpose |
|---|---|
| `deploy.sh` | The Firebase deploy above |
| `deploy-functions.ts` | Functions deploy wrapper: pack `@oww/shared`, write build info, restore on exit |
| `prepare-functions-deploy.ts` | The functions predeploy hook that points `functions/package.json` at the packed tarball |
| `deploy-gateway.ts` | Gateway build and deploy to the Raspberry Pi |
| `deploy-kiosk.ts` | Kiosk installer build |
| `deploy-preflight.ts` | Refuse unless both repos are on the latest `main` |
| `release.ts` | Reuse the commit's `vYYYY.M.N` tag or cut the next one |
| `build-version.ts` | The version every component reports; also the Vite plugin both web apps use |
| `deploy-steps.ts` | List the pending `docs/deploy/` steps, or print the agent prompt |
| `deploy-record.ts` | Record a deploy or a manual ops event (`event --env … --note …`) |
| `deploy-log.ts` | Pure log and `STATE.md` rendering behind `deploy-record.ts` |
| `device-status-read.ts` | Read what the terminals, gateways and kiosks report running (ADC) |
| `setup-bigquery.ts` | Create or extend the `stats` dataset, tables and views |

Tests sit next to their scripts and run with `npm run test:scripts`.
