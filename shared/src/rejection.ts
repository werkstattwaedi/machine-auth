// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Machine-readable rejection causes shared across the whole stack.
 *
 * A terminal check-in (`handleTerminalCheckin`) can reject a badge-in for
 * several distinct reasons that must NOT be conflated into one "Nicht
 * berechtigt" screen (issue #535). The server is the source of truth: it
 * returns this `reason` plus a human `message` and a deep link to the generic
 * `/denied` landing page. The MaCo branches on the reason for layout; the web
 * page renders richer per-cause copy from {@link rejectionCopy}.
 *
 * IMPORTANT: the integer values MUST stay aligned with:
 *   - the `RejectionReason` proto enum in `proto/firebase_rpc/auth.proto`
 *     (consumed by functions + firmware), and
 *   - `maco::firebase::RejectionReason` in the firmware
 *     (`maco_firmware/modules/firebase/public/firebase/types.h`).
 * Adding a value means adding it in all three places with the same number.
 */
export enum RejectionReason {
  Unspecified = 0,
  MissingPermission = 1,
  StaleCheckout = 2,
  TokenUnknown = 3,
  TokenDeactivated = 4,
}

/**
 * Stable, URL-safe string form of a {@link RejectionReason}. This is what the
 * server bakes into the `/denied?cause=…` deep link, so it must stay stable
 * even if enum ordering ever changes.
 */
export type RejectionCause =
  | "unspecified"
  | "missing_permission"
  | "stale_checkout"
  | "token_unknown"
  | "token_deactivated"

const REASON_TO_CAUSE: Record<RejectionReason, RejectionCause> = {
  [RejectionReason.Unspecified]: "unspecified",
  [RejectionReason.MissingPermission]: "missing_permission",
  [RejectionReason.StaleCheckout]: "stale_checkout",
  [RejectionReason.TokenUnknown]: "token_unknown",
  [RejectionReason.TokenDeactivated]: "token_deactivated",
}

const CAUSE_TO_REASON: Record<RejectionCause, RejectionReason> = {
  unspecified: RejectionReason.Unspecified,
  missing_permission: RejectionReason.MissingPermission,
  stale_checkout: RejectionReason.StaleCheckout,
  token_unknown: RejectionReason.TokenUnknown,
  token_deactivated: RejectionReason.TokenDeactivated,
}

/** Map a numeric reason (proto enum value) to its URL-safe cause code. */
export function rejectionCause(reason: RejectionReason | number): RejectionCause {
  return REASON_TO_CAUSE[reason as RejectionReason] ?? "unspecified"
}

/**
 * Parse a `cause` query-parameter back into a {@link RejectionCause}. Unknown
 * or missing values collapse to `"unspecified"` so the landing page always has
 * something to render.
 */
export function parseRejectionCause(
  value: string | null | undefined
): RejectionCause {
  if (value != null && value in CAUSE_TO_REASON) {
    return value as RejectionCause
  }
  return "unspecified"
}

/** Parameters that a copy template may interpolate. */
export interface RejectionCopyParams {
  /** Formatted date of the stale checkout (e.g. `14.07.2026`). */
  date?: string
}

/** A heading + body pair for the `/denied` landing page. */
export interface RejectionCopy {
  heading: string
  body: string
}

/**
 * German copy for the generic `/denied` landing page, keyed by cause. This is
 * deliberately richer than the one-line message the MaCo shows — the web page
 * has room to explain the next action.
 */
export function rejectionCopy(
  cause: RejectionCause,
  params: RejectionCopyParams = {}
): RejectionCopy {
  switch (cause) {
    case "stale_checkout":
      return {
        heading: "Letzter Besuch noch offen",
        body: params.date
          ? `Schliesse deinen letzten Besuch vom ${params.date} ab, bevor du die Maschinen heute nutzt.`
          : "Schliesse deinen letzten Besuch ab, bevor du die Maschinen heute nutzt.",
      }
    case "missing_permission":
      return {
        heading: "Berechtigung fehlt",
        body: "Für diese Maschine brauchst du eine zusätzliche Berechtigung. Melde dich bei der Werkstattleitung, um sie zu erhalten.",
      }
    case "token_unknown":
      return {
        heading: "Badge unbekannt",
        body: "Dieser Badge ist nicht registriert. Melde dich bei der Werkstattleitung, um ihn freizuschalten.",
      }
    case "token_deactivated":
      return {
        heading: "Badge deaktiviert",
        body: "Dieser Badge wurde deaktiviert. Melde dich bei der Werkstattleitung.",
      }
    case "unspecified":
    default:
      return {
        heading: "Nicht berechtigt",
        body: "Du kannst diese Maschine gerade nicht nutzen. Melde dich bei der Werkstattleitung, wenn das nicht stimmt.",
      }
  }
}
