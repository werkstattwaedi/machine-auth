// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  addDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from "firebase/firestore"
import { printJobsCollection } from "@modules/lib/firestore-helpers"

// How long the gateway connect + 1.5s linger plus Firestore round-trips may
// take before we give up waiting for a terminal status. The gateway's own
// printer connect timeout is 3s, so 15s leaves comfortable headroom for a
// busy printer / slow listener without hanging the UI indefinitely.
const PRINT_RESULT_TIMEOUT_MS = 15_000

// Time-to-live for the job doc (matches the Firestore TTL policy intent).
const JOB_TTL_MS = 60 * 60 * 1000

function bytesToBase64(bytes: Uint8Array): string {
  // Chunk to stay well under argument-count limits for String.fromCharCode;
  // raster jobs are tens of KB, so a single pass would also work, but this
  // is robust for larger labels.
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Enqueue a label print job for the on-LAN gateway and resolve once it
 * reports a terminal status.
 *
 * Writes a `queued` `printJobs` doc carrying the pre-built Brother raster
 * bytes, then watches that doc: resolves on `status == "done"`, rejects on
 * `status == "error"` (with the gateway's German message), and rejects with
 * a timeout if no terminal status arrives. Designed to be passed straight to
 * `useAsyncMutation`, which owns the toast on both paths.
 */
export function enqueuePrintJob(
  db: Firestore,
  { bytes, tape, uid }: { bytes: Uint8Array; tape: string; uid: string },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    addDoc(printJobsCollection(db), {
      bytesB64: bytesToBase64(bytes),
      tape,
      status: "queued",
      createdBy: uid,
      createdAt: serverTimestamp() as unknown as Timestamp,
      ttlAt: Timestamp.fromMillis(Date.now() + JOB_TTL_MS),
    })
      .then((ref) => {
        let settled = false
        const finish = (err?: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          unsubscribe()
          if (err) reject(err)
          else resolve()
        }

        const timer = setTimeout(
          () => finish(new Error("Drucker nicht erreichbar (Zeitüberschreitung)")),
          PRINT_RESULT_TIMEOUT_MS,
        )

        const unsubscribe = onSnapshot(
          ref,
          (snap) => {
            const data = snap.data()
            if (!data) return
            if (data.status === "done") finish()
            else if (data.status === "error") {
              finish(new Error(data.error || "Druckfehler"))
            }
          },
          (err) => finish(err instanceof Error ? err : new Error(String(err))),
        )
      })
      .catch((err) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      )
  })
}
