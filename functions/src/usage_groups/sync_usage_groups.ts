// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Copies the Freiwilligengruppe / Interne Nutzung Workspace groups onto
 * `users/{uid}.usageGroups` (ADR-0053, ADM-11): hourly, and from the admin
 * sync report on demand.
 *
 * Workspace is the source of truth — the field is written here and nowhere
 * else (the rules pin it for every client, ADM-12). An account is in a group
 * when its `users.email` is one of the group's addresses; the check-in and
 * the close read the field, never Workspace, so a Workspace outage only
 * delays changes. A group whose address param is empty isn't synced at all:
 * its holders keep it rather than every volunteer losing it to a missing
 * config value.
 *
 * Cost: one read per account in a group, plus one per current holder (and
 * one per membership when the admin page asks for it), and a
 * write only for an account whose groups changed.
 */

import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  FieldValue,
  getFirestore,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import {
  USAGE_GROUPS,
  usageGroupsOf,
  type UsageGroup,
} from "@oww/shared";
import { normalizeEmail } from "../auth/identity";
import { resolveVerifiedMembership } from "../membership/verified_membership";
import type { UserEntity } from "../types/firestore_entities";
import { cloudIdentityDirectory, type GroupDirectory } from "./directory";

const groupEmailParams: Record<UsageGroup, ReturnType<typeof defineString>> = {
  volunteering: defineString("USAGE_GROUP_VOLUNTEERING_EMAIL", { default: "" }),
  intern: defineString("USAGE_GROUP_INTERN_EMAIL", { default: "" }),
};

/** The configured group address per usage group; empty = not synced. */
export function usageGroupEmails(): Record<UsageGroup, string> {
  return {
    volunteering: groupEmailParams.volunteering.value().trim(),
    intern: groupEmailParams.intern.value().trim(),
  };
}

export interface UsageGroupSyncGroup {
  group: UsageGroup;
  /** Null when the group's address isn't configured (not synced). */
  groupEmail: string | null;
  /** Addresses in the group. */
  members: number;
  /** Addresses in the group that match no account (ADM-13). */
  unmatched: string[];
}

export interface UsageGroupAccount {
  userId: string;
  name: string;
  email: string;
  groups: UsageGroup[];
  /**
   * An active membership lists the account (MEM-11); ADM-14 warns if not.
   * Always false when the run skipped the lookup (`withMembership: false`).
   */
  member: boolean;
}

export interface UsageGroupSyncReport {
  syncedAt: string;
  groups: UsageGroupSyncGroup[];
  /** Accounts whose groups this run changed. */
  changed: number;
  /** Every account in a group after the run, with its membership. */
  accounts: UsageGroupAccount[];
}

export interface UsageGroupSyncDeps {
  db: Firestore;
  directory: GroupDirectory;
  groupEmails: Record<UsageGroup, string>;
  now?: () => Date;
  /**
   * Resolve each account's membership for the report (ADM-14). The hourly
   * run skips it — only the admin page shows it, and it costs a read per
   * account.
   */
  withMembership?: boolean;
}

/** Firestore `in` takes at most 30 values. */
const IN_LIMIT = 30;

async function usersByEmail(
  db: Firestore,
  emails: readonly string[],
): Promise<Map<string, { id: string; data: DocumentData }[]>> {
  const out = new Map<string, { id: string; data: DocumentData }[]>();
  for (let i = 0; i < emails.length; i += IN_LIMIT) {
    const chunk = emails.slice(i, i + IN_LIMIT);
    const snap = await db.collection("users").where("email", "in", chunk).get();
    for (const doc of snap.docs) {
      const email = doc.data().email as string;
      out.set(email, [...(out.get(email) ?? []), { id: doc.id, data: doc.data() }]);
    }
  }
  return out;
}

function sameGroups(a: readonly UsageGroup[], b: readonly UsageGroup[]): boolean {
  return a.length === b.length && a.every((g) => b.includes(g));
}

export async function runUsageGroupSync(
  deps: UsageGroupSyncDeps,
): Promise<UsageGroupSyncReport> {
  const { db, directory, groupEmails } = deps;
  const now = deps.now ?? (() => new Date());

  // Who holds a group today — every one of them is either confirmed or
  // loses it below.
  const holders = await db
    .collection("users")
    .where("usageGroups", "array-contains-any", [...USAGE_GROUPS])
    .get();
  const current = new Map<string, UsageGroup[]>();
  const userData = new Map<string, DocumentData>();
  for (const doc of holders.docs) {
    current.set(doc.id, usageGroupsOf(doc.data().usageGroups));
    userData.set(doc.id, doc.data());
  }

  // Start from today's holders and redo each synced group from Workspace.
  const desired = new Map<string, Set<UsageGroup>>();
  for (const [uid, groups] of current) desired.set(uid, new Set(groups));

  const groups: UsageGroupSyncGroup[] = [];
  for (const group of USAGE_GROUPS) {
    const groupEmail = groupEmails[group];
    if (!groupEmail) {
      groups.push({ group, groupEmail: null, members: 0, unmatched: [] });
      continue;
    }
    const emails = (await directory.memberEmails(groupEmail)).map(normalizeEmail);
    const byEmail = await usersByEmail(db, emails);
    for (const set of desired.values()) set.delete(group);
    const unmatched: string[] = [];
    for (const email of emails) {
      const docs = byEmail.get(email) ?? [];
      if (docs.length === 0) unmatched.push(email);
      // Two accounts on one e-mail break login (ADR-0043); both get the
      // group here, and the identity audit reports the pair.
      if (docs.length > 1) {
        logger.warn("Usage group address matches several accounts", {
          group,
          uids: docs.map((d) => d.id),
        });
      }
      for (const d of docs) {
        if (!desired.has(d.id)) desired.set(d.id, new Set());
        desired.get(d.id)!.add(group);
        userData.set(d.id, d.data);
      }
    }
    groups.push({ group, groupEmail, members: emails.length, unmatched });
  }

  // Write only what changed, in the USAGE_GROUPS order.
  let changed = 0;
  let batch = db.batch();
  let pending = 0;
  for (const [uid, set] of desired) {
    const next = USAGE_GROUPS.filter((g) => set.has(g));
    if (sameGroups(next, current.get(uid) ?? [])) continue;
    batch.update(db.collection("users").doc(uid), {
      usageGroups: next.length > 0 ? next : FieldValue.delete(),
    });
    changed++;
    if (++pending === 450) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  const accounts: UsageGroupAccount[] = [];
  for (const [uid, set] of desired) {
    const accountGroups = USAGE_GROUPS.filter((g) => set.has(g));
    if (accountGroups.length === 0) continue;
    const data = userData.get(uid);
    const membership = deps.withMembership === false
      ? null
      : await resolveVerifiedMembership(
        db.collection("users").doc(uid),
        data as UserEntity | undefined,
      );
    accounts.push({
      userId: uid,
      name: [data?.firstName, data?.lastName].filter(Boolean).join(" "),
      email: (data?.email as string | undefined) ?? "",
      groups: accountGroups,
      member: membership !== null,
    });
  }
  accounts.sort((a, b) => a.name.localeCompare(b.name, "de"));

  return { syncedAt: now().toISOString(), groups, changed, accounts };
}

function defaultDeps(withMembership: boolean): UsageGroupSyncDeps {
  return {
    db: getFirestore(),
    directory: cloudIdentityDirectory(),
    groupEmails: usageGroupEmails(),
    withMembership,
  };
}

/** Counts only: the addresses and names stay out of the logs. */
function logReport(report: UsageGroupSyncReport): void {
  logger.info("Usage groups synced", {
    changed: report.changed,
    groups: report.groups.map((g) => ({
      group: g.group,
      configured: g.groupEmail !== null,
      members: g.members,
      unmatched: g.unmatched.length,
    })),
  });
}

export const syncUsageGroups = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "Europe/Zurich",
    timeoutSeconds: 300,
  },
  async () => {
    logReport(await runUsageGroupSync(defaultDeps(false)));
  },
);

/**
 * Admin callable behind the sync report (ADM-11, ADM-13, ADM-14): runs the
 * sync now and returns what it found.
 */
export const syncUsageGroupsHandler = async (
  request: CallableRequest<unknown>,
): Promise<UsageGroupSyncReport> => {
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  try {
    const report = await runUsageGroupSync(defaultDeps(true));
    logReport(report);
    return report;
  } catch (e) {
    logger.warn("Usage group sync failed", {
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw new HttpsError(
      "unavailable",
      "Google Workspace ist gerade nicht erreichbar. Bitte später nochmals versuchen.",
    );
  }
};
