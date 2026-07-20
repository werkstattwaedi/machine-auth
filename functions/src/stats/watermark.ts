// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Per-stream export watermarks, stored in the server-only `export_state`
 * collection (one doc per stream: visits, machine_usage, bills,
 * membership_snapshots).
 *
 * The watermark is advanced ONLY after a successful sink insert; a crash
 * between insert and advance re-exports the batch and the `*_v` dedup views
 * absorb the duplicates. `lastDocId` is the cursor tiebreak for docs sharing
 * the watermark timestamp (the resume is `startAfter(watermark, lastDocId)`,
 * never a bare `> watermark`).
 *
 * The trim/erasure engines read these watermarks too: a doc whose age-basis
 * timestamp is past its stream's watermark has not been exported yet and
 * must be flushed before deletion (ADR-0038).
 */

import { Firestore, Timestamp } from "firebase-admin/firestore";

export const EXPORT_STATE_COLLECTION = "export_state";

export interface StreamState {
  watermark: Timestamp;
  lastDocId: string;
}

export const EPOCH_STATE: StreamState = {
  watermark: Timestamp.fromMillis(0),
  lastDocId: "",
};

export async function getStreamState(
  db: Firestore,
  stream: string
): Promise<StreamState> {
  const snap = await db.collection(EXPORT_STATE_COLLECTION).doc(stream).get();
  if (!snap.exists) return EPOCH_STATE;
  const data = snap.data()!;
  return {
    watermark: (data.watermark as Timestamp) ?? EPOCH_STATE.watermark,
    lastDocId: (data.lastDocId as string) ?? "",
  };
}

/**
 * True when a doc's age-basis timestamp lies strictly past the stream's
 * watermark cursor — i.e. the daily export has NOT covered it yet. Trim
 * skips such docs; erasure flushes them to the sink before deleting
 * (ADR-0038 §guard).
 */
export function isUnexported(
  ts: Timestamp | null | undefined,
  docId: string,
  state: StreamState
): boolean {
  if (!ts) return false;
  const cmp = ts.toMillis() - state.watermark.toMillis();
  if (cmp !== 0) return cmp > 0;
  return docId > state.lastDocId;
}

export async function advanceStreamState(
  db: Firestore,
  stream: string,
  state: StreamState
): Promise<void> {
  await db.collection(EXPORT_STATE_COLLECTION).doc(stream).set({
    watermark: state.watermark,
    lastDocId: state.lastDocId,
    updatedAt: Timestamp.now(),
  });
}

/**
 * Where the export keeps its per-stream cursor. Production uses Firestore;
 * dry-runs use the in-memory store so previewing a backfill can never
 * advance the REAL watermark — a falsely-advanced watermark would both
 * hole the BigQuery history and let trim/erasure delete unexported docs
 * (`isUnexported` would wrongly report them as covered).
 */
export interface StreamStateStore {
  get(stream: string): Promise<StreamState>;
  advance(stream: string, state: StreamState): Promise<void>;
}

export function firestoreStateStore(db: Firestore): StreamStateStore {
  return {
    get: (stream) => getStreamState(db, stream),
    advance: (stream, state) => advanceStreamState(db, stream, state),
  };
}

/**
 * Reads the seed cursor from Firestore once per stream, keeps every
 * advance local. `db: null` seeds from epoch (pure in-memory runs).
 */
export function memoryStateStore(db: Firestore | null): StreamStateStore {
  const cache = new Map<string, StreamState>();
  return {
    async get(stream) {
      let state = cache.get(stream);
      if (!state) {
        state = db ? await getStreamState(db, stream) : EPOCH_STATE;
        cache.set(stream, state);
      }
      return state;
    },
    async advance(stream, state) {
      cache.set(stream, state);
    },
  };
}
