# ADR-0023: Canonical Firestore access pattern

**Status:** Accepted

**Date:** 2026-04-26

## Context

Web app code touched Firestore through three competing styles:

1. **Typed ref builders** in `web/modules/lib/firestore-helpers.ts`
   (`userRef(db, id)`, `machineRef(db, id)`, …) — only called when a
   `DocumentReference` field had to be **written** into another doc.
2. **String-path realtime hooks** in `web/modules/lib/firestore.ts`
   (`useDocument<T>("checkouts/x")`, `useCollection<T>("permission")`)
   — used by ~30 admin and checkout pages, with the entity type
   provided as an inline `<T>` generic.
3. **String-path mutations** in `web/modules/hooks/use-firestore-mutation.ts`
   (`set("users", id, data)`, `update("permission", id, data)`,
   `add("checkouts", data)`, `remove("permission", id)`) — wrapping
   `setDoc`/`addDoc`/`updateDoc`/`deleteDoc` to add audit fields.

Consequences of the split:

- The CLAUDE.md rule "always use DocumentReferences, not string paths"
  was honoured on cross-doc writes (style 1) but invisible to the type
  system everywhere else. New code reverted to the variant the nearest
  neighbour used.
- Inline `interface UserDoc {…}`, `interface CheckoutDoc {…}`,
  `interface PermissionDoc {…}` declarations had drifted across 4 files
  for `CheckoutDoc` alone (3 each for the others) — all hand-written,
  all subtly different.
- A consumer reading or writing `checkouts/{id}/items/{itemId}` had to
  construct the path string by hand every call site.

Audit finding A3 from the 2026-04-25 launch-readiness review (issue
#145) called for unifying these.

## Decision

The canonical Firestore access pattern in the web apps is:

1. **One source of truth for doc shapes** —
   `web/modules/lib/firestore-entities.ts` exports a `*Doc` interface
   for every collection (`UserDoc`, `MachineDoc`, `CheckoutDoc`,
   `CheckoutItemDoc`, `BillDoc`, `PermissionDoc`, `MacoDoc`,
   `TokenDoc`, `UsageMachineDoc`, `CatalogItemDoc`, `PriceListDoc`,
   `PricingConfigDoc`, `AuditLogDoc`, `OperationsLogDoc`). Each is the
   wire format described in `firestore/schema.jsonc`.
2. **Typed builders for every ref** — `web/modules/lib/firestore-helpers.ts`
   exposes `usersCollection(db) → CollectionReference<UserDoc>`,
   `userRef(db, id) → DocumentReference<UserDoc>`, and matching pairs
   for each entity (including subcollections like
   `checkoutItemsCollection(db, checkoutId)`). The generic `T` is a
   plain TypeScript narrowing; no Firestore `withConverter` is
   attached because the wire format already matches the TS shape.
3. **Hooks accept refs, never strings** — `useDocument<T>(ref)` and
   `useCollection<T>(refOrQuery, …constraints)` take typed refs (or
   `null` to skip). The `T` is inferred from the ref's generic. The
   `LISTENER_DELAY_MS` (50ms StrictMode-safe debounce) and the
   `logClientError` reporting are preserved verbatim — they were
   added to fix real Firestore SDK and Cloud Logging bugs.
4. **Mutations accept refs** — `useFirestoreMutation` exposes
   `set(ref, data)`, `add(collectionRef, data)`, `update(ref, data)`,
   `remove(ref)`. The audit-field wrapper (`modifiedBy`, `modifiedAt`)
   stays on every write.
5. **All cross-doc links are `DocumentReference`s in the wire format**
   — the schema is uniform on this. The single documented exception
   is `price_lists.items: string[]`, which has to be plain document
   IDs because Firestore's `documentId() in […]` query only accepts
   raw IDs.

The string-path overloads are removed entirely; there is no
deprecation period. New code that tries `useDocument("users/u1")` or
`set("users", id, …)` will fail TypeScript.

## Consequences

**Pros:**

- The "DocumentReference, not path-string" rule is enforced by the
  type system on every read **and** write, not just hand-policed in
  review.
- Doc shapes live in one file. Schema changes in
  `firestore/schema.jsonc` get a single matching edit in
  `firestore-entities.ts`.
- Subcollection paths (`checkouts/{id}/items/{itemId}`) and field
  names (`requiredPermission`, `usage_machine`) are typed at the
  builder layer, so a typo turns into a compile error instead of a
  silent permission-denied at runtime.
- New code stops re-deriving inline doc types; existing duplicates
  are gone (the 4× `CheckoutDoc`, 3× `MachineDoc`, etc.).

**Cons:**

- Every callsite needs `useDb()` so it can build the typed ref. The
  hook is cheap (one `useContext`) but does add a line per file.
- `useFirestoreMutation`'s audit-field wrapper has to spread the
  caller's `data` object into a generic-friendly shape; the type
  signatures are slightly noisier than the old `(path, id, data)`
  triples.
- Test files that mocked `firebase/firestore`'s `collection()` /
  `doc()` to redirect to FakeFirestore still work, but now the
  mock has to surface the `path` field on the returned object so
  the hooks' error logging picks up the right path.

**Tradeoffs:**

- *Keep both styles, rely on review.* Rejected because the audit
  showed that's exactly what produced the fragmentation in the first
  place. The type system has to enforce the rule.
- *Use Firestore `withConverter` for runtime type safety.* Rejected
  for now — the wire format already matches the TS shape, so
  converters would only add boilerplate without catching new bugs.
  We can add converters later for a specific entity if we ever need
  runtime validation (e.g. for a non-trivial migration).
- *Migrate incrementally with deprecation tags.* Rejected. There is
  no production data yet; the user explicitly asked to do this in
  one push so future work doesn't have to navigate two parallel
  patterns.
