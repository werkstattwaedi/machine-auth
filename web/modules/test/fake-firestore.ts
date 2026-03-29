// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * In-memory Firestore fake for unit tests.
 *
 * Supports the subset of the Firestore SDK used by this app:
 * - collection/doc path builders
 * - onSnapshot (collection + document, with real-time updates)
 * - setDoc, addDoc, updateDoc, deleteDoc, getDoc
 * - where (==, array-contains, in), orderBy, limit query constraints
 * - serverTimestamp
 */

// ── Types ──────────────────────────────────────────────────────────────

type DocData = Record<string, unknown>
type Listener = () => void

export interface FakeDocRef {
  readonly type: "document"
  readonly id: string
  readonly path: string
  readonly parent: FakeCollectionRef
}

export interface FakeCollectionRef {
  readonly type: "collection"
  readonly id: string
  readonly path: string
}

interface WhereConstraint {
  kind: "where"
  field: string
  op: "==" | "array-contains" | "in"
  value: unknown
}

interface OrderByConstraint {
  kind: "orderBy"
  field: string
  direction: "asc" | "desc"
}

interface LimitConstraint {
  kind: "limit"
  count: number
}

export type FakeQueryConstraint = WhereConstraint | OrderByConstraint | LimitConstraint

export interface FakeQuery {
  type: "query"
  collectionPath: string
  constraints: FakeQueryConstraint[]
}

interface FakeDocSnapshot {
  id: string
  ref: FakeDocRef
  exists(): boolean
  data(): DocData | undefined
}

interface FakeQueryDocSnapshot {
  id: string
  ref: FakeDocRef
  data(): DocData
}

interface FakeQuerySnapshot {
  docs: FakeQueryDocSnapshot[]
  empty: boolean
  size: number
}

// ── FakeFirestore ──────────────────────────────────────────────────────

export class FakeFirestore {
  /** collection path → doc ID → data */
  private store = new Map<string, Map<string, DocData>>()
  /** path → listeners (collection path or doc path) */
  private listeners = new Map<string, Set<Listener>>()
  private idCounter = 0

  // ── Internal helpers ──

  private getCollection(path: string): Map<string, DocData> {
    let col = this.store.get(path)
    if (!col) {
      col = new Map()
      this.store.set(path, col)
    }
    return col
  }

  private notifyListeners(path: string) {
    // Notify collection listeners
    const colListeners = this.listeners.get(path)
    if (colListeners) {
      for (const cb of colListeners) cb()
    }

    // If path is a doc path (has even number of segments), also notify parent collection
    const segments = path.split("/")
    if (segments.length % 2 === 0) {
      const colPath = segments.slice(0, -1).join("/")
      const parentListeners = this.listeners.get(colPath)
      if (parentListeners) {
        for (const cb of parentListeners) cb()
      }
    }
    // If path is a collection, notify all doc listeners within it
    if (segments.length % 2 === 1) {
      const col = this.store.get(path)
      if (col) {
        for (const docId of col.keys()) {
          const docPath = `${path}/${docId}`
          const docListeners = this.listeners.get(docPath)
          if (docListeners) {
            for (const cb of docListeners) cb()
          }
        }
      }
    }
  }

  private addListener(path: string, cb: Listener): () => void {
    let set = this.listeners.get(path)
    if (!set) {
      set = new Set()
      this.listeners.set(path, set)
    }
    set.add(cb)
    return () => {
      set!.delete(cb)
      if (set!.size === 0) this.listeners.delete(path)
    }
  }

  private generateId(): string {
    return `auto_${++this.idCounter}`
  }

  private resolveTimestamps(data: DocData): DocData {
    const result: DocData = {}
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && (v as { _fake: string })._fake === "serverTimestamp") {
        result[k] = new Date()
      } else {
        result[k] = v
      }
    }
    return result
  }

  // ── Path builders ──

  collection(path: string): FakeCollectionRef {
    const segments = path.split("/")
    return {
      type: "collection",
      id: segments[segments.length - 1],
      path,
    }
  }

  doc(...segments: string[]): FakeDocRef {
    const path = segments.join("/")
    const parts = path.split("/")
    const id = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join("/")
    return {
      type: "document",
      id,
      path,
      parent: this.collection(parentPath),
    }
  }

  // ── Read operations ──

  getDoc(ref: FakeDocRef): FakeDocSnapshot {
    const colPath = ref.parent.path
    const col = this.store.get(colPath)
    const data = col?.get(ref.id)
    return {
      id: ref.id,
      ref,
      exists: () => data !== undefined,
      data: () => (data ? { ...data } : undefined),
    }
  }

  // ── Write operations ──

  setDoc(ref: FakeDocRef, data: DocData): void {
    const col = this.getCollection(ref.parent.path)
    col.set(ref.id, this.resolveTimestamps(data))
    this.notifyListeners(ref.path)
  }

  addDoc(colRef: FakeCollectionRef, data: DocData): FakeDocRef {
    const id = this.generateId()
    const col = this.getCollection(colRef.path)
    col.set(id, this.resolveTimestamps(data))
    const ref = this.doc(colRef.path, id)
    this.notifyListeners(colRef.path)
    return ref
  }

  updateDoc(ref: FakeDocRef, data: DocData): void {
    const col = this.getCollection(ref.parent.path)
    const existing = col.get(ref.id)
    if (!existing) throw new Error(`Document ${ref.path} does not exist`)
    col.set(ref.id, { ...existing, ...this.resolveTimestamps(data) })
    this.notifyListeners(ref.path)
  }

  deleteDoc(ref: FakeDocRef): void {
    const col = this.getCollection(ref.parent.path)
    col.delete(ref.id)
    this.notifyListeners(ref.path)
  }

  // ── Query ──

  private applyConstraints(
    docs: [string, DocData][],
    constraints: FakeQueryConstraint[],
  ): [string, DocData][] {
    let result = [...docs]

    for (const c of constraints) {
      if (c.kind === "where") {
        result = result.filter(([, data]) => {
          const fieldVal = this.getFieldValue(data, c.field)
          switch (c.op) {
            case "==":
              return this.equals(fieldVal, c.value)
            case "array-contains":
              return Array.isArray(fieldVal) && fieldVal.some((v) => this.equals(v, c.value))
            case "in":
              return Array.isArray(c.value) && c.value.some((v) => this.equals(fieldVal, v))
            default:
              return true
          }
        })
      }
    }

    // Apply orderBy
    const orderBys = constraints.filter((c): c is OrderByConstraint => c.kind === "orderBy")
    if (orderBys.length > 0) {
      result.sort((a, b) => {
        for (const ob of orderBys) {
          const aVal = this.getFieldValue(a[1], ob.field)
          const bVal = this.getFieldValue(b[1], ob.field)
          const cmp = this.compare(aVal, bVal)
          if (cmp !== 0) return ob.direction === "desc" ? -cmp : cmp
        }
        return 0
      })
    }

    // Apply limit
    const limitC = constraints.find((c): c is LimitConstraint => c.kind === "limit")
    if (limitC) {
      result = result.slice(0, limitC.count)
    }

    return result
  }

  private getFieldValue(data: DocData, field: string): unknown {
    const parts = field.split(".")
    let current: unknown = data
    for (const p of parts) {
      if (current == null || typeof current !== "object") return undefined
      current = (current as Record<string, unknown>)[p]
    }
    return current
  }

  private equals(a: unknown, b: unknown): boolean {
    // Compare FakeDocRefs by path
    if (a && typeof a === "object" && "path" in a && b && typeof b === "object" && "path" in b) {
      return (a as { path: string }).path === (b as { path: string }).path
    }
    return a === b
  }

  private compare(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a == null) return -1
    if (b == null) return 1
    if (typeof a === "number" && typeof b === "number") return a - b
    if (typeof a === "string" && typeof b === "string") return a.localeCompare(b)
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    return 0
  }

  // ── Snapshot listeners ──

  onSnapshotDoc(ref: FakeDocRef, callback: (snap: FakeDocSnapshot) => void): () => void {
    const fire = () => {
      callback(this.getDoc(ref))
    }
    // Fire immediately with current state
    fire()
    return this.addListener(ref.path, fire)
  }

  onSnapshotCollection(
    colRef: FakeCollectionRef,
    constraints: FakeQueryConstraint[],
    callback: (snap: FakeQuerySnapshot) => void,
  ): () => void {
    const fire = () => {
      const col = this.store.get(colRef.path) ?? new Map<string, DocData>()
      const filtered = this.applyConstraints([...col.entries()], constraints)
      const docs: FakeQueryDocSnapshot[] = filtered.map(([id, data]) => ({
        id,
        ref: this.doc(colRef.path, id),
        data: () => ({ ...data }),
      }))
      callback({ docs, empty: docs.length === 0, size: docs.length })
    }
    fire()
    return this.addListener(colRef.path, fire)
  }

  // ── Test helpers ──

  /** Clear all data and listeners */
  clear() {
    this.store.clear()
    this.listeners.clear()
    this.idCounter = 0
  }

  /** Get raw data for a document (for assertions) */
  getData(collectionPath: string, docId: string): DocData | undefined {
    return this.store.get(collectionPath)?.get(docId)
  }

  /** Get all docs in a collection (for assertions) */
  getAllDocs(collectionPath: string): Map<string, DocData> {
    return new Map(this.store.get(collectionPath) ?? [])
  }
}

// ── SDK-compatible wrapper functions ───────────────────────────────────
// These mirror the Firebase Firestore SDK functions but work with FakeFirestore.

export function fakeCollection(db: FakeFirestore, path: string): FakeCollectionRef
export function fakeCollection(db: FakeFirestore, ...segments: string[]): FakeCollectionRef
export function fakeCollection(db: FakeFirestore, ...segments: string[]): FakeCollectionRef {
  return db.collection(segments.join("/"))
}

export function fakeDoc(db: FakeFirestore, ...segments: string[]): FakeDocRef {
  return db.doc(...segments)
}

export function fakeServerTimestamp() {
  return { _fake: "serverTimestamp" }
}

// ── Query builder ──

export function fakeWhere(field: string, op: "==" | "array-contains" | "in", value: unknown): WhereConstraint {
  return { kind: "where", field, op, value }
}

export function fakeOrderBy(field: string, direction: "asc" | "desc" = "asc"): OrderByConstraint {
  return { kind: "orderBy", field, direction }
}

export function fakeLimit(count: number): LimitConstraint {
  return { kind: "limit", count }
}
