// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared helpers for email-based login (6-digit code + magic link).
 * Used by request / verify-code / verify-link.
 */

import * as crypto from "crypto";
import { getAuth } from "firebase-admin/auth";
import { defineString } from "firebase-functions/params";

/**
 * Comma-separated list of allowed production origins (exact-match).
 * Set via Firebase Functions params, e.g.:
 *   `https://checkout.werkstattwaedi.ch,https://admin.werkstattwaedi.ch,https://oww-maco.web.app`
 *
 * Previously we wildcarded `*.web.app` / `*.firebaseapp.com`, which let any
 * attacker-controlled Firebase-hosted site request a magic link pointing to
 * itself — the user clicks, the attacker's site gets the custom token.
 */
const loginAllowedOrigins = defineString("LOGIN_ALLOWED_ORIGINS", {
  default: "",
});

/** Any localhost / 127.0.0.1 origin — allowed in emulator mode only. */
const LOCALHOST_ORIGIN_REGEX =
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Sanity-only check — server doesn't do deep validation, provider does. */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** 32 random bytes as base64url — doubles as the magic-link token. */
export function generateDocId(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCode(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

/** Binds the code to a specific doc so a leaked code can't replay elsewhere. */
export function hashCode(code: string, docId: string): string {
  return crypto.createHash("sha256").update(`${code}|${docId}`).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  // Localhost is only honored in emulator mode — a browser on a user's
  // machine setting Origin: http://localhost against a production function
  // would be a misconfiguration, not a legitimate request.
  if (isEmulator() && LOCALHOST_ORIGIN_REGEX.test(origin)) return true;
  return parseAllowedOrigins(loginAllowedOrigins.value()).has(origin);
}

/** Exposed for tests — takes the param value so tests don't need to stub defineString. */
export function isOriginInList(
  origin: string | undefined | null,
  allowlist: string
): boolean {
  if (!origin) return false;
  if (isEmulator() && LOCALHOST_ORIGIN_REGEX.test(origin)) return true;
  return parseAllowedOrigins(allowlist).has(origin);
}

function parseAllowedOrigins(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

export function buildMagicLink(origin: string, docId: string): string {
  return `${origin}/login/verify?token=${encodeURIComponent(docId)}`;
}

export type LoginMethod = "emailCode" | "magicLink";

/**
 * Resolve-or-create a Firebase Auth user by email, then mint a custom token.
 *
 * Mirrors the legacy email-link flow: if no user exists, one is created
 * without a password. The web client swaps the custom token for a session
 * via signInWithCustomToken(). The `method` claim is useful for audit /
 * telemetry — which path the user actually took.
 */
export async function mintSessionToken(
  email: string,
  method: LoginMethod
): Promise<string> {
  const auth = getAuth();
  let uid: string;
  try {
    const user = await auth.getUserByEmail(email);
    uid = user.uid;
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "auth/user-not-found") {
      const created = await auth.createUser({ email });
      uid = created.uid;
    } else {
      throw err;
    }
  }
  return auth.createCustomToken(uid, { loginMethod: method });
}
