// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Compose a user's display name from `firstName` + `lastName`.
 *
 * Centralises the `\`${firstName ?? ""} ${lastName ?? ""}\`.trim()` snippet
 * that was previously duplicated across 16+ call sites (web + functions)
 * after `userDoc.displayName` was removed in #207.
 *
 * The function is intentionally pure (no Firebase Auth lookups) and takes
 * an explicit `fallback` because call sites use different ones — e.g.
 * `user.id`, `email`, `"Jemand"`, the literal `"–"`. When `fallback` is
 * omitted, an empty string is returned for fully-empty inputs so callers
 * can chain their own `||` expression if they prefer.
 *
 * Mirrors `web/modules/lib/username-utils.ts`. The two implementations
 * are kept in sync by code review — web + functions don't share a build
 * pipeline, so extracting to a true shared module would touch tsconfig
 * paths in 3 places (issue #229).
 */
export function formatFullName(
  input: { firstName?: string | null; lastName?: string | null },
  fallback?: string
): string {
  const firstName = input.firstName ?? "";
  const lastName = input.lastName ?? "";
  const full = `${firstName} ${lastName}`.trim();
  if (full.length > 0) return full;
  return fallback ?? "";
}
