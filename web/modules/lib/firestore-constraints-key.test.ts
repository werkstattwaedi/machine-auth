// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `constraintsKey` against the REAL Firebase SDK (firestore.test.tsx mocks
 * `where`/`doc`). It reads the SDK's constraint objects, so an SDK upgrade
 * that changes their shape must fail here rather than silently fall back to
 * path-only keying — the kiosk roster leak of issue #689.
 */

import { describe, expect, it } from "vitest"
import { initializeApp } from "firebase/app"
import {
  Timestamp,
  doc,
  documentId,
  getFirestore,
  limit,
  orderBy,
  where,
} from "firebase/firestore"
import { constraintsKey } from "./firestore"

const db = getFirestore(
  initializeApp({ projectId: "demo-key", apiKey: "x" }, "constraints-key"),
)

describe("constraintsKey (real SDK)", () => {
  it("is empty without constraints", () => {
    expect(constraintsKey([])).toBe("")
  })

  it("is equal for equal constraints built separately", () => {
    const build = () => [
      where("userId", "==", doc(db, "users/A")),
      where("status", "==", "open"),
    ]
    expect(constraintsKey(build())).toBe(constraintsKey(build()))
    expect(constraintsKey(build())).not.toBe("")
  })

  it("tells document-ref filter values apart", () => {
    expect(constraintsKey([where("userId", "==", doc(db, "users/A"))])).not.toBe(
      constraintsKey([where("userId", "==", doc(db, "users/B"))]),
    )
  })

  it("tells primitive, array, timestamp, order and limit values apart", () => {
    const pairs = [
      [where("role", "==", "admin"), where("role", "==", "member")],
      [where(documentId(), "in", ["a"]), where(documentId(), "in", ["b"])],
      [
        where("t", ">", Timestamp.fromMillis(1)),
        where("t", ">", Timestamp.fromMillis(2)),
      ],
      [orderBy("t", "asc"), orderBy("t", "desc")],
      [limit(5), limit(6)],
    ] as const
    for (const [a, b] of pairs) {
      expect(constraintsKey([a])).not.toBe(constraintsKey([b]))
    }
  })
})
