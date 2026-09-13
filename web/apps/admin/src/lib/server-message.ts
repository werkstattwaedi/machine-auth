// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The server's own message for a failed callable, when it has one.
 * `useAsyncMutation` maps well-known codes to German copy but has no case
 * for `failed-precondition`, which is exactly the code the billing
 * callables use for their German guard messages ("… ist bereits bezahlt").
 * Looks at the thrown error and its `originalError` (the raw
 * FirebaseError) so the guard text reaches the admin verbatim.
 */
export function serverMessage(err: unknown, fallback: string): string {
  const candidates = [
    (err as { originalError?: unknown } | null)?.originalError,
    err,
  ]
  for (const c of candidates) {
    if (c && typeof c === "object" && "message" in c) {
      const msg = (c as { message?: unknown }).message
      if (typeof msg === "string" && msg.length > 0 && msg !== fallback) {
        // FirebaseError messages are "<code>: <text>" from httpsCallable;
        // strip the code prefix when present.
        return msg.replace(/^[a-z-]+:\s+/, "")
      }
    }
  }
  return fallback
}
