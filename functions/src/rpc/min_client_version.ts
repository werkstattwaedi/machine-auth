// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The minimum web-client version (#845): `config/clients.minVersion`, set by
 * `scripts/deploy/set-min-client-version.ts` around a deploy that changes a
 * data shape the old clients can't read. The dispatchers refuse calls from a
 * client that reports an older version, so a tab that missed the reload
 * can't write anything.
 *
 * Read at most once a minute per instance: a dispatcher call must not pay a
 * Firestore read, and a minute's lag after setting the minimum is harmless
 * (the clients themselves react to the doc at once).
 */

import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const CACHE_MS = 60_000;

type Loader = () => Promise<string | null>;

async function loadFromFirestore(): Promise<string | null> {
  const snap = await getFirestore().collection("config").doc("clients").get();
  const min = snap.get("minVersion");
  return typeof min === "string" && min ? min : null;
}

let loader: Loader = loadFromFirestore;
let cached: { value: string | null; at: number } | null = null;

export async function getMinClientVersion(now = Date.now()): Promise<string | null> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  try {
    cached = { value: await loader(), at: now };
  } catch (err) {
    // An unreadable config must not take every callable down: let the call
    // through and try again on the next one.
    logger.warn("min client version unreadable", { err: String(err) });
    // Keep the last known value (or none) for another minute instead of
    // adding a failing read to every call during an outage.
    cached = { value: cached?.value ?? null, at: now };
    return cached.value;
  }
  return cached.value;
}

/** Tests: swap the source and drop the cache (`undefined` restores Firestore). */
export function setMinClientVersionLoaderForTest(next: Loader | undefined): void {
  loader = next ?? loadFromFirestore;
  cached = null;
}
