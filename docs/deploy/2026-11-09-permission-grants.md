---
phase: after-deploy
---

# Permission grants: migrate `users.permissions` to the grant map (#843)

From this release on, `users.permissions` is a map of grants keyed by
permission id, recording who granted each permission, when and from where.
The functions read both the old list of refs and the map, so machine
check-ins keep working during the step. The rules now refuse any client
write to the field, admins included: admins grant through the
`grantPermission` / `revokePermission` callables. Web apps from before this
release still expect the list and break on a migrated doc, so they are
forced to reload first (#845).

Needs ADC (`gcloud auth application-default login`), run from the released
`main` checkout. Best done at night: open apps reload, and admin grants are
refused in the minutes between the rules deploy and the migration.

**What:**

1. Force open web apps onto the new build. It refuses if hosting doesn't
   serve this release yet:

   ```bash
   npx tsx scripts/deploy/set-min-client-version.ts --env <staging|prod>
   ```

2. Dry run, then the migration:

   ```bash
   FIREBASE_PROJECT_ID=<project-id> npx tsx scripts/migrate-permission-grants.ts --prod --dry-run
   FIREBASE_PROJECT_ID=<project-id> npx tsx scripts/migrate-permission-grants.ts --prod
   ```

   The dry run prints how many users and grants would change, and how many
   get a date and a granter from the audit log. Grants older than the audit
   log stay without them and show «seit unbekanntem Datum». It prints uids
   only.

3. Record it:

   ```bash
   npx tsx scripts/deploy/deploy-record.ts event --env <env> --note "users.permissions migrated to grant maps (#843)"
   ```

**How to check it worked:** the real run ends with "Gate passes: no users
doc holds a list." (exit code 3 otherwise; it names the uids). Then:
- open a person with permissions in the admin app: the Berechtigungen tab
  shows each permission with «seit …»;
- grant and remove a test permission there;
- a check-in on a machine that requires a permission still unlocks for a
  holder.

**Already done?** A dry run that reports "to migrate: 0", and
`config/clients.minVersion` already at this release (the script prints
before → after).

**Without it:**
- Old open apps keep running against new data. An admin page still on the
  old build tries to write the list and is refused.
- Docs that are not migrated keep working for check-ins and reads, but the
  admin app shows their grants without a date.
- The legacy-list branch in `heldPermissionIds` can't be removed until both
  environments pass the gate.

**Staging vs prod:** run it on staging first and check it there; same
commands with the staging project.
