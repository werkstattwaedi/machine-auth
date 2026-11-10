---
phase: before-functions
---

# edoobox courses: API key, config and mails (#842)

From this release on, course leaders run their edoobox courses in the
checkout (Kursleitung, docs/spec/courses.md). The new `courseCall` and the
daily `syncCourses` read and write edoobox with an API key. They need, per
environment, before the functions deploy:

- the secrets `EDOOBOX_API_KEY` / `EDOOBOX_API_SECRET`. A functions deploy
  that binds a secret missing from Secret Manager fails.
- the param `EDOOBOX_API_BASE_URL`. Empty switches the courses off: «Kurse
  sind nicht eingerichtet».
- the mails `course-close-reminder` and `course-close-office` published as
  Resend templates.

Staging talks to the edoobox **sandbox** account, production to the real one.
Never give staging the production key.

**What:**

1. **The key (ask the human).** In edoobox, Einstellungen →
   API-Zugriffsverwaltung → Schlüssel hinzufügen. For production, use an
   authorisation group with read on dates, offers, bookings, users and admins
   (`date`, `offe`, `book`, `user`, `admi`, `setti`, `tag`) and write on
   attendance and notes (`atte`, `note`). The sandbox may use a superadmin
   key. The key and secret are shown once.

2. **Secrets:**

   ```bash
   printf %s '<key>'    | gcloud secrets create EDOOBOX_API_KEY    --project <project-id> --data-file=-
   printf %s '<secret>' | gcloud secrets create EDOOBOX_API_SECRET --project <project-id> --data-file=-
   ```

   Use `printf %s`, not `echo`: a trailing newline would become part of the
   secret. If the secret already exists, use
   `gcloud secrets versions add … --data-file=-` instead.

3. **Config.** In the operations repo, set the values in this environment's
   config and regenerate the env files (`npx tsx scripts/generate-env.ts`):
   - `functions.edooboxApiBaseUrl`:
     - staging: `https://sandbox.app.edoobox.ch/v2`
     - prod: the account's v2 host, e.g. `https://app2.edoobox.com/v2`
   - `functions.edooboxAttendanceStatuses`: optional; default `1,2,3,4`.
   - `functions.courseOfficeEmail`: where the day-7 notice goes. Empty
     skips it.

4. **Mails.** Publish the operations repo's `email/` templates to this
   environment. The publish is additive, so it is safe before the deploy.

**How to check it worked:**
- `gcloud secrets versions access latest --secret EDOOBOX_API_KEY --project <project-id> | wc -c`
  is non-zero.
- After the deploy, link a test person to an edoobox leader in the admin
  app (Person → Profil → Kursleitung). The card lists the account's
  edoobox admins and «n Kurse in edoobox».

**Already done?** Both secrets exist, the param is set in the env file, and
the two templates are in Resend under `<env>-course-close-…`.

**Without it:**
- The deploy fails on the missing secrets.
- An empty base URL leaves Kursleitung empty («Kurse sind nicht
  eingerichtet»).
- Missing templates make the reminders fail (logged; the course still
  works).

**Fresh installation:** `docs/deployment-checklist.md` lists the same.
