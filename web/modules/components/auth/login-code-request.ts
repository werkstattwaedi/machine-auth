// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared plumbing for requesting a 6-digit login code — used by the /login
 * page, the embedded check-in sign-in, and any future code-based flow.
 */

/** The 60s per-email resend throttle (`resource-exhausted`). The previously
 *  sent code is still valid in that case, so callers advance instead of
 *  dead-ending on an error toast. */
export function isResendThrottleError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "functions/resource-exhausted"
  )
}

/**
 * Request a login code, treating the 60s resend throttle as success: a prior
 * unconsumed code stays valid (only a successful re-request invalidates it),
 * so the caller should advance to the code stage either way and merely word
 * the toast differently. Any other error re-throws.
 */
export async function requestCodeWithThrottle(
  requestLoginEmail: (email: string) => Promise<void>,
  email: string,
): Promise<{ throttled: boolean }> {
  try {
    await requestLoginEmail(email)
    return { throttled: false }
  } catch (err: unknown) {
    if (isResendThrottleError(err)) return { throttled: true }
    throw err
  }
}
