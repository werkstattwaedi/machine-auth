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
