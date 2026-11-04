// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Reads Google Workspace group membership through the Cloud Identity
 * Groups API (ADR-0053).
 *
 * The functions' runtime service account calls the API as itself — no
 * domain-wide delegation, no key: it is made an owner of the two groups
 * (or given the Groups Reader admin role), which is what lets it list
 * their members. External addresses come back like any other member.
 */

import { GoogleAuth } from "google-auth-library";
import { normalizeEmail } from "../auth/identity";

/** Group membership as the sync needs it — swapped out in tests. */
export interface GroupDirectory {
  /**
   * Every address in the group, nested groups resolved, normalised like
   * `users.email`. Service accounts (the reader itself) are left out.
   */
  memberEmails(groupEmail: string): Promise<string[]>;
}

const API = "https://cloudidentity.googleapis.com/v1";

interface Membership {
  preferredMemberKey?: { id?: string };
  type?: "USER" | "SERVICE_ACCOUNT" | "GROUP" | "SHARED_DRIVE" | "OTHER";
}

export function cloudIdentityDirectory(): GroupDirectory {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-identity.groups.readonly"],
  });

  async function get<T>(url: string, params: Record<string, string>): Promise<T> {
    const client = await auth.getClient();
    const res = await client.request<T>({ url, params });
    return res.data;
  }

  async function groupName(groupEmail: string): Promise<string> {
    const data = await get<{ name: string }>(`${API}/groups:lookup`, {
      "groupKey.id": groupEmail,
    });
    return data.name;
  }

  async function collect(
    groupEmail: string,
    seen: Set<string>,
    out: Set<string>,
  ): Promise<void> {
    const key = normalizeEmail(groupEmail);
    // A group nested in itself (directly or through another) is listed once.
    if (seen.has(key)) return;
    seen.add(key);
    const name = await groupName(groupEmail);
    let pageToken: string | undefined;
    do {
      const page = await get<{
        memberships?: Membership[];
        nextPageToken?: string;
      }>(`${API}/${name}/memberships`, {
        view: "FULL",
        pageSize: "500",
        ...(pageToken ? { pageToken } : {}),
      });
      for (const m of page.memberships ?? []) {
        const id = m.preferredMemberKey?.id;
        if (!id) continue;
        if (m.type === "GROUP") await collect(id, seen, out);
        else if (m.type !== "SERVICE_ACCOUNT") out.add(normalizeEmail(id));
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  return {
    async memberEmails(groupEmail) {
      const out = new Set<string>();
      await collect(groupEmail, new Set(), out);
      return [...out].sort();
    },
  };
}
