---
phase: before-functions
---

# Workspace groups behind Freiwilligengruppe / Interne Nutzung (ADR-0053)

From this release on, the check-in offers *Freiwilligengruppe* and *Interne
Nutzung* only to accounts in the matching Google Workspace group, and the
server refuses them for anyone else (CHK-51, CHK-53). Group membership
reaches the accounts through the hourly `syncUsageGroups` job, which reads
the groups through the Cloud Identity Groups API. This step sets that up
before the functions deploy. Without it, nobody is in either group once the
new functions run: volunteers lose *Freiwilligengruppe* and pay for machine
time, and internal projects can't be checked in as *Interne Nutzung*.

**What:**

1. Enable the Cloud Identity API:

   ```bash
   gcloud services enable cloudidentity.googleapis.com --project <project-id>
   ```

2. Find the functions' runtime service account. It is the default compute
   service account unless the project sets another one:

   ```bash
   gcloud projects describe <project-id> --format='value(projectNumber)'
   # → <project-number>-compute@developer.gserviceaccount.com
   ```

   A Workspace admin then adds it as an **owner** of both groups, in Google
   Groups → the group → Members → Add members. Alternatively, assign it the
   *Groups Reader* admin role. Ask the human for this; it needs a Workspace
   admin login. Both groups must allow members from outside the
   organisation, must not let anyone join on their own (membership is what
   grants the waiver), and any group nested in them must be readable by the
   same service account, or the whole sync fails.

3. In the operations repo config of this environment, set
   `functions.usageGroupVolunteeringEmail` and
   `functions.usageGroupInternEmail` to the two group addresses, commit, and
   run `npm run generate-env` in machine-auth. Staging may point at the same
   groups as prod or at test groups. An empty value leaves that group
   unsynced: nobody gets it, and existing holders keep it.

**Check / already done:**

- `gcloud services list --enabled --project <project-id> | grep cloudidentity`
- `functions/.env.<project-id>` has both `USAGE_GROUP_*_EMAIL` values filled in.
- **Right after the functions deploy**, open admin → Personen → **Gruppen**
  in that environment. Until a sync has run nobody holds a group, and the
  close refuses volunteers. The page runs the sync at once, where the hourly
  job could take up to an hour. Each group should list its accounts, and a 403 /
  "Google Workspace ist gerade nicht erreichbar" means step 2 is missing.
  Look through the "Adressen ohne Konto" list together with the team. Those
  are group members whose address matches no account's `users.email`, and
  they won't get the type until the addresses agree.

**Without it:** see above. The checkout keeps working for everyone else.

**Staging vs prod:** the same steps on both. Each project has its own
runtime service account, so each one must be added to the groups.
