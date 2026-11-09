// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `users.permissions` (#843): a map of grants keyed by permission id, each
 * saying who granted it, when and from where. A grant with `windows` holds
 * only inside one of them (a course's Termine, #842); without, it holds for
 * good. Read it only through these helpers.
 *
 * Generic over the SDK: the Admin SDK and the web SDK have their own
 * DocumentReference and Timestamp classes; only `id` and `toMillis()` are
 * needed here.
 */

export type PermissionGrantSource = "admin" | "course" | "legacy"

export interface RefLike {
  id: string
}

export interface TimestampLike {
  toMillis(): number
}

export interface PermissionGrant<
  Ref extends RefLike = RefLike,
  Ts extends TimestampLike = TimestampLike,
> {
  /** `permission/{id}`; same id as the map key. */
  permission: Ref
  /** null for grants from before #843 ("legacy"). */
  grantedAt: Ts | null
  /** `users/{uid}` of the admin or course leader; null for legacy grants. */
  grantedBy: Ref | null
  source: PermissionGrantSource
  /** The edoobox course that granted it (#842). */
  course?: { offerId: string }
  /** Set = temporary: holds only for `from ≤ now < until` of a window. */
  windows?: Array<{ from: Ts; until: Ts }>
}

export type PermissionGrants<
  Ref extends RefLike = RefLike,
  Ts extends TimestampLike = TimestampLike,
> = Record<string, PermissionGrant<Ref, Ts>>

/**
 * What a users doc may hold: the grant map, or the list of refs from before
 * the migration. The list is still read so a terminal check-in between the
 * deploy and the migration works; drop it once both environments are
 * migrated (scripts/migrate-permission-grants.ts).
 */
export type StoredPermissions =
  | PermissionGrants
  | ReadonlyArray<RefLike>
  | null
  | undefined

export function isGrantActive(grant: PermissionGrant, nowMs: number): boolean {
  if (!grant.windows) return true
  return grant.windows.some(
    (w) => w.from.toMillis() <= nowMs && nowMs < w.until.toMillis(),
  )
}

/** Every permission granted, temporary ones included (admin views). */
export function grantedPermissionIds(stored: StoredPermissions): string[] {
  if (!stored) return []
  if (Array.isArray(stored)) return (stored as ReadonlyArray<RefLike>).map((r) => r.id)
  return Object.keys(stored)
}

/** The permissions that hold at `nowMs` — what a machine checks. */
export function heldPermissionIds(stored: StoredPermissions, nowMs: number): string[] {
  if (!stored) return []
  if (Array.isArray(stored)) return (stored as ReadonlyArray<RefLike>).map((r) => r.id)
  return Object.entries(stored as PermissionGrants)
    .filter(([, grant]) => isGrantActive(grant, nowMs))
    .map(([id]) => id)
}

/** The grant for one permission, as a legacy grant if the doc isn't migrated yet. */
export function permissionGrantOf(
  stored: StoredPermissions,
  permissionId: string,
): PermissionGrant | null {
  if (!stored) return null
  if (Array.isArray(stored)) {
    const ref = (stored as ReadonlyArray<RefLike>).find((r) => r.id === permissionId)
    return ref ? { permission: ref, grantedAt: null, grantedBy: null, source: "legacy" } : null
  }
  return (stored as PermissionGrants)[permissionId] ?? null
}
