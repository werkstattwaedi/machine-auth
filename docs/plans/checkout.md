# Unified Checkout with Machine Usage Integration

## PRD

### Problem

The Offene Werkstatt Wädenswil operates on trust and self-service. Users come to the workshop, use machines and materials, and self-report what they used at checkout. The current system has two disconnected tracking systems:

1. **NFC machine sessions**: MACO terminals log who used which machine and when — but this data never flows into billing. Users see raw machine IDs and timestamps with no costs.
2. **Manual cost entries**: Users separately estimate machine hours and materials. This is tedious — they have to remember what they used and look up prices.

The result: machine usage tracking and billing are completely disjoint. Users estimate roughly, prices are hard to look up, and there's no running total during a visit.

### Goal

Make it **easy to do the right thing**. Users should see their accumulated costs during a visit without extra effort. NFC-measured machine time should flow naturally into billing. Manual entries should be simple. The system stays trust-based — no rigid process.

### User Personas & Access Modes

| Persona | How they arrive | Account? | NFC tag? | Checkout experience |
|---------|----------------|----------|----------|-------------------|
| **Member with NFC** | Has account, trained on gated machines | Yes | Yes | **Shopping cart**: NFC sessions auto-accumulate, manual entries for materials, close when done |
| **Visitor with account** | Created account via email self-registration | Yes | No | **Shopping cart**: same experience, just no NFC machine entries. Self-reports all usage manually. |
| **Walk-in** | Doesn't want an account | No | No | **Anonymous checkout**: one-shot form, fill person info + all costs at once, no persistence |

**Key distinction:**
- **Shopping cart** (requires account): Open checkout persists across the visit. NFC sessions auto-accumulate into line items. Manual entries save on the fly. User closes checkout when done paying.
- **Anonymous checkout** (no account): Fill in everything in one wizard session. No persistence, no shopping cart.

**Account creation**: Self-registration exists — enter email → receive magic link → account auto-created. The `vereinsmitglied` role is granted by admins to financial supporters of the Verein; it affects pricing (discounted rates) but is not auto-assigned.

### Machine gating

All machines that incur hourly costs are gated by NFC terminals. Users tap in, use the machine, and the system tracks their time automatically. Smaller machines that don't require hourly payment are not gated and don't generate line items.

Many workshop activities (painting, ceramics, textiles) don't involve billable machines at all — users self-report only material costs. The shopping cart handles both NFC-tracked machine hours and manual material entries.

### Workshop visit tracking

We want to know which workshops users visited — even if they incurred no costs there. This is for informing future investment decisions (how many people visited Holzwerkstatt this month?).

The checkout carries an explicit list of workshops visited. This is separate from line items — a user might visit the Keramik workshop and use materials (→ line items) AND visit the Malen workshop just to paint without any billable items (→ still tracked as visited).

### What changes vs. what stays

| Aspect | Current | New |
|--------|---------|-----|
| NFC machine sessions | Raw log, no costs shown | Auto-accumulated into checkout line items with computed cost |
| Machine hours in checkout | User manually estimates | NFC-measured, auto-accumulated, read-only. No manual machine hour entry. |
| Material entries | Created in `usage_material`, loosely linked to checkout | Created directly as checkout line items |
| Checkout document | Just refs + total, no structured line items | Self-contained with line items subcollection |
| Dashboard (logged-in) | Shows separate NFC sessions + manual entries | Shows open checkout with all items, running total |
| Workshop tracking | Inferred from line items | Explicit workshops-visited list on checkout |
| Anonymous checkout | 3-step wizard | Stays the same — one-shot, no persistence |
| `usage_material` collection | Source of truth for billing | Replaced by checkout items. Nuke existing test data. |
| `materials` collection | Standalone material catalog | Unified into `catalog` — holds both materials and machine hour templates |
| `config/pricing` | Single mega-document with embedded machine prices | Slimmed down: keeps entry fees, workshops (metadata only), labels. Machine prices move to `catalog`. |

---

## Decisions

| Decision | Choice |
|----------|--------|
| Unified catalog | `catalog/{itemId}` replaces both `materials/{materialId}` and machine configs from `config/pricing`. All billable things in one collection. |
| Config simplification | `config/pricing` stays as one document (avoids extra reads on 100K ops/month budget). Machine prices removed — now in `catalog`. Keeps entry fees, workshop metadata, labels. |
| Machine → catalog mapping | Each physical machine doc gets `workshop` + `checkoutTemplateId` (DocumentReference to `catalog/{itemId}`) |
| `usage_machine` | Pure audit log. Never edited. `checkoutItemRef` links to the checkout item it was billed under. |
| Checkout lifetime | Open until explicitly closed (user hasn't paid until they close it) |
| Machine hours | Exclusively from NFC. No manual entry. Read-only at checkout — users cannot adjust. |
| Accumulation logic | Cloud Function on usage upload updates checkout item quantity + totalPrice |
| Pricing computation | `unitPrice` set at item creation (from `catalog.unitPrice[discount]`). `totalPrice` = quantity × unitPrice. |
| Escalation for corrections | Out of scope. Future: admin flow to adjust machine hours on closed/open checkouts. |
| Entry fees | Inferred from `persons[].userType` + checkout-level `usageType` at close time. Not stored per-person. |
| Usage type | Top-level on checkout (no mixed usage types). |
| Item pricing | `catalogId` on checkout item references `catalog/{itemId}`. `unitPrice` at creation, `totalPrice` = quantity × unitPrice. |
| Services | does not exist anymore |
| Shopping cart | Requires account. Anonymous = one-shot wizard (also uses items subcollection for consistency). |
| Migration | None — nuke test data, start fresh |

---

## Data Model

### `catalog/{itemId}` — unified billable items

Replaces both `materials/{materialId}` and the machine configs embedded in `config/pricing`. Every billable thing — machine hours, materials, sandblasting, 3D printing — lives here.

The `itemId` is a regular Firebase auto-generated ID. Items are found by name, code, or query.

```
catalog/{itemId}                             ← auto-generated Firebase ID
  code: string                               ← unique human-manageable lookup code (e.g., "1042")
                                                for non-QR lookup at the counter
  name: string                               ← "Stationäre Maschinen", "Sperrholz Birke 4mm",
                                                "Sandstrahlen Klein", "PLA (3D Druck)"
  workshops: string[]                        ← ["holz"], ["holz", "metall"], etc.
                                                a material can be available in multiple workshops
  pricingModel: "time" | "area" | "length" | "count" | "weight" | "direct"
                                             ← determines what quantity represents AND the base unit:
                                                time → hours
                                                area → m²
                                                length → meters
                                                count → pieces
                                                weight → kg
                                                direct → CHF (user enters price, no unit price)
                                                UI handles display/input units (min→h, cm→m, g→kg)
  unitPrice: { none: number, member: number, intern: number }
                                             ← conditional price per base unit by discount level
                                                for "direct": ignored (user enters price)
  active: boolean
  userCanAdd: boolean                        ← true = users can add this to their checkout
                                                false = only system (Cloud Function) creates items
                                                (NFC machine hours: false; materials: true)
  description?: string | null                ← extended description
```

**Key simplification:** No more `objectSizePrices` or `materialPrices` maps. Each variant is its own catalog entry. Every item has a uniform `unitPrice` map. No model-specific fields.

**QR code grouping:** Deferred to a separate entity (future scope). Not on catalog.

**Examples:**
| name | pricingModel | userCanAdd | unitPrice.none |
|------|-------------|-----------|---------------|
| Stationäre Maschinen | time | false | 10/h |
| Drechselbank | time | false | 10/h |
| Sandstrahlen Klein | count | false | 5/stk |
| Sandstrahlen Gross | count | false | 20/stk |
| PLA (3D Druck) | weight | false | 50/kg |
| PETG (3D Druck) | weight | false | 70/kg |
| Sperrholz Birke 4mm | area | true | 45/m² |
| Kantholz Fichte | length | true | 12/m |

Physical machines point to their catalog entry:

```
machine/{machineId}:
  name: "Fräse"
  workshop: "holz"
  checkoutTemplateId: "catalog/{itemId}"   ← DocumentReference to catalog entry
  ...existing fields...
```

### `config/pricing` — simplified (single document)

Stays as one document to minimize reads (100K ops/month budget). Machine configs and prices removed — now in `catalog`.

```
config/pricing
  entryFees: {
    erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 }
    kind: { regular: 7.5, materialbezug: 0, intern: 0, hangenmoos: 7.5 }
    firma: { regular: 30, materialbezug: 0, intern: 0, hangenmoos: 30 }
  }
  workshops: {
    holz: { label: "Holzwerkstatt", order: 1 }
    metall: { label: "Metallwerkstatt", order: 2 }
    textil: { label: "Textil Atelier", order: 3 }
    ...
  }
  labels: {
    units: { m2: "m²", m: "m", stk: "Stk.", chf: "CHF", h: "Std.", kg: "kg", g: "g", l: "l" }
    discounts: { none: "Kein Rabatt", member: "Mitglied OWW", intern: "Intern" }
  }
```

Workshops no longer embed machine configs or prices — those live in `catalog/`. Workshop metadata is just labels and ordering.

### `checkouts/{checkoutId}` — the shopping cart

The checkout acts as a discriminated union on `status`: when open, only the core fields exist. When closed, a `summary` object with all computed totals appears alongside close-time details.

```
checkouts/{checkoutId}

  // --- Always present ---
  userId: DocumentReference
  status: "open" | "closed"
  usageType: "regular" | "materialbezug" | "intern" | "hangenmoos"  ← no "ermaessigt"; vereinsmitglied + regular = discounted automatically
  created: timestamp
  workshopsVisited: ["holz", "metall", ...]
  persons: [{ name, email, userType, billingAddress? }]   ← no fee (inferred), no usageType (top-level)
  modifiedBy: string | null
  modifiedAt: timestamp

  // --- Only present when status == "closed" ---
  closedAt: timestamp
  notes: string | null
  summary: {                           ← queryable snapshot of final totals
    totalPrice: number                 ← everything included
    entryFees: number                  ← sum of person entry fees
    machineCost: number                ← sum of machine hours items
    materialCost: number               ← sum of material items
    tip: number                        ← tip lives here only (one place)
  }
```

While open, the dashboard computes these totals ephemerally as a view of the items subcollection. Only when closed are the totals written to `summary` for querying/reporting.

In Firestore, the "union" is modeled by convention: `closedAt`, `notes`, and `summary` fields are simply absent on open checkouts and present on closed ones.

**Rules:**
- A user has at most ONE open checkout at a time
- Created implicitly when first cost is incurred (NFC session or manual entry)
- Stays open until user explicitly closes (checks out and pays)
- `usageType` is top-level — no mixed usage types in a single checkout
- Entry fees are not stored per-person; they're inferred from `persons[].userType` + `usageType` at close time
- Email reminder for long-open checkouts (future)

### `checkouts/{checkoutId}/items/{itemId}` — line items

All item IDs are auto-generated. For NFC-accumulated items, the Cloud Function queries by `catalogId` to find/update the right item.

```
checkouts/{checkoutId}/items/{itemId}        ← auto-generated
  workshop: string                           ← "holz", "metall", ...
  description: string                        ← human-readable label (from catalog.name)
  origin: "nfc" | "manual" | "qr"
  catalogId: string | null                   ← DocumentReference to catalog/{itemId}
                                                null for free-form items (user enters price directly)
  created: timestamp

  // --- Pricing & quantity (top-level for easy reads) ---
  quantity: number                           ← the computed/entered amount in the item's unit
                                                hours, pieces, m², grams, etc.
  unitPrice: number                          ← set at creation: catalog.unitPrice[discount]
                                                for free-form (catalogId=null): user-entered
  totalPrice: number                         ← quantity × unitPrice
                                                updated whenever quantity changes

  // --- Form state (for re-populating input fields) ---
  formInputs?: [{ quantity: number, unit: string }]
                                             ← array of user-entered values before conversion
                                                e.g., area: [{quantity: 60, unit: "cm"}, {quantity: 40, unit: "cm"}]
                                                      time: [{quantity: 30, unit: "min"}]
                                                      weight: [{quantity: 150, unit: "g"}]
                                                allows re-populating forms with original input units
```

**Key design:**
- **No `type` field** — the `catalogId` references a `catalog` entry which determines pricing model, unit, and rates.
- **No `discountLevel`** — discount is derived from the user's `vereinsmitglied` role at checkout level, not per-item.
- **No `modifiedBy/At`** — while open, items are freely editable (no audit). Once closed, items are immutable.
- **`quantity` is top-level** — the canonical amount in the catalog's base unit (hours, m², meters, kg, pieces). Computed from `formInputs` when user enters in display units (e.g., 60cm × 40cm → 0.24 m²; 150g → 0.15 kg; 30min → 0.5h).
- **`unitPrice` set at creation** — looked up from `catalog` entry + user discount level. For free-form items (catalogId=null), user enters directly.
- **`totalPrice` = quantity × unitPrice** — updated whenever quantity changes. Always reflects current state.
- **`formInputs` is optional** — array of `{quantity, unit}` pairs preserving user's original input values and units. Allows re-populating the form on edit. Not used for price computation (top-level `quantity` already holds the converted value).

**NFC-accumulated machine hours (read-only):**
- Cloud Function queries items by `catalogId` to find existing item for that billing category
- ONE item per billing category — all sessions for that category fold into this item
- Cloud Function is the sole writer — updates `quantity` (total hours) and `totalPrice`
- `unitPrice` set at item creation (Cloud Function looks up `catalog` entry + user's discount level)
- **Users cannot edit these items** — the NFC-measured time is authoritative (`catalog.userCanAdd == false`)
- Individual sessions visible by querying `usage_machine` where `checkoutItemRef == itemRef`
- Corrections require escalation (out of scope — future admin flow)

**Manual entries (materials only):**
- Document ID = auto-generated
- `catalogId` references `catalog/{itemId}` (if applicable) or null for free-form
- Fully editable while checkout is open
- No manual machine hour entry — all machine billing comes from NFC

**Anonymous checkout:**
- Also uses items subcollection (consistent model)
- Checkout created with `status: "closed"` immediately on submit (no open phase)
- Items created and prices computed in a single batch at submit time

### `usage_machine/{usageId}` — audit trail (unchanged concept)

```
usage_machine/{usageId}
  userId: DocumentReference
  authenticationId: DocumentReference | null
  machine: DocumentReference
  checkIn: timestamp
  checkOut: timestamp | null
  checkOutReason: string | null
  checkout: DocumentReference | null        ← points to checkout where time was accumulated
```

Pure audit log. Never edited by users. The `checkout` field links it to the checkout where its time was billed.

### `usage_material` — removed

Replaced entirely by `checkouts/{id}/items/{id}`. No migration needed — only test data exists.

### `materials` — replaced by `catalog`

The `materials` collection is subsumed by the unified `catalog` collection. Material entries gain conditional pricing (`unitPrice` map with discount levels) and coexist with machine hour templates. `shortlistGroup` is removed — QR code management will be a separate entity (future).

### `config/pricing` — simplified

Stays as one document (avoids extra reads). Machine configs and their prices removed — now in `catalog`. Retains entry fees, workshop metadata (label + order), and display labels.

---

## Flows

### NFC session → checkout item (Cloud Function)

```
1. MACO terminal uploads usage → usage_machine record created
2. Cloud Function:
   a. Look up machine doc → get workshop + checkoutTemplateId (catalog ref)
   b. Find user's open checkout (or create one)
   c. Query items subcollection where catalogId == checkoutTemplateId
      → if not found: create item with unitPrice from catalog.unitPrice[discount]
   d. Query all usage_machine where checkoutItemRef == null and machine maps to same catalog entry
      → sum hours (endTime - startTime)
   e. Update item: quantity + totalPrice (= quantity × unitPrice)
   f. Set usage_machine.checkoutItemRef = itemRef
```

### Manual entry → checkout item (Web app, materials only)

```
1. User on dashboard selects workshop, enters material usage
2. Web app finds open checkout (or creates one)
3. Creates item in checkout subcollection with auto-generated ID
   → unitPrice resolved from catalog entry + user discount (or user-entered for free-form)
   → totalPrice = quantity × unitPrice
4. On quantity changes: totalPrice recomputed and persisted
5. Saves on blur (same UX as today)
```

No manual machine hour entry. All machine billing is driven by NFC sessions.

### Workshop visit tracking

```
1. User selects workshops on dashboard (checkboxes, same UI as today)
2. Web app updates checkout.workshopsVisited array
3. Queryable: "how many checkouts included holz this month?"
```

### Closing checkout (Web app)

```
1. User clicks "Zum Checkout"
2. Wizard shows items from open checkout (read from subcollection — prices already persisted)
3. User can still add/edit manual material items (machine hours are read-only)
4. User adds person info (name, email, userType), confirms usageType
5. Confirms total, adds tip
6. On submit:
   a. Compute entry fees from persons[].userType + usageType
   b. Compute summary: { totalPrice, entryFees, machineCost, materialCost, tip }
      (machineCost + materialCost = sum of item totalPrices, already persisted)
   c. Update checkout: status="closed", closedAt, summary, notes, persons
7. Show payment QR
```

### Pricing model

Two independent discount axes:

**Entry fees** (computed at close time, per person):
```
fee = f(person.userType, checkout.usageType)
  e.g., erwachsen + regular → CHF 15
        kind + regular → CHF 7.50
        erwachsen + materialbezug → CHF 0
```

**Item prices** (computed incrementally — unitPrice at creation, totalPrice on every quantity change):
```
1. At item creation:
   a. Look up catalogId → get catalog entry (pricingModel, unitPrice)
   b. Read user doc → vereinsmitglied? → "member" discount : "none" (full price)
   c. Resolve unitPrice = catalog.unitPrice[discount] (or user-entered for free-form)
   d. Write unitPrice on item

2. On every quantity change:
   a. totalPrice = quantity × unitPrice
      - time/count/weight/length: quantity converted from formInputs to base unit
      - area: quantity computed from formInputs (e.g., 60cm × 40cm → 0.24 m²)
      - direct (catalogId=null): user enters totalPrice directly, quantity = 1
   b. Persist totalPrice on item
```

Entry fees and item discounts are independent. `usageType` → entry fees. `vereinsmitglied` role → machine hour discounts.

---

## Future (out of scope)

- **Escalation flow for machine hour corrections** — admin/user flow to dispute or adjust NFC-measured hours
- Email reminders for long-open checkouts
- QR code entity for material grouping/management (replaces `shortlistGroup`)
- QR-scanned materials auto-populating label/price from `catalog`
- Admin corrections of closed checkouts
- Analytics/reporting dashboard querying line items
- Self-checkout via NFC tap on phone (A2 flow)
