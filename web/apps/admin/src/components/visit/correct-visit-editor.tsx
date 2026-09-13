// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// The lean correction editor (ADR-0042): persons (user type + waiver),
// usage type, free-form line items, tip. Purely presentational — the page
// owns the draft (`lib/visit-correction.ts`) and the estimate.

import { useRef } from "react"
import {
  USAGE_TYPE_LABELS,
  USER_TYPE_LABELS,
  type UsageType,
  type UserType,
} from "@oww/shared"
import { formatCHF } from "@modules/lib/format"
import { Button } from "@modules/components/ui/button"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@modules/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import {
  USAGE_TYPES,
  newItemRow,
  rowTotal,
  type CorrectionDraft,
  type DraftItem,
  type DraftPerson,
} from "@/lib/visit-correction"
import { Plus, X } from "lucide-react"

export function CorrectVisitEditor({
  draft,
  onChange,
  workshops,
  disabled,
  idPrefix = "correct",
}: {
  draft: CorrectionDraft
  onChange: (next: CorrectionDraft) => void
  /** Workshop ids offered for new / moved lines (from config/pricing). */
  workshops: string[]
  disabled?: boolean
  /** Unique per editor instance when several are on one page. */
  idPrefix?: string
}) {
  const nextKey = useRef(0)
  const patch = (partial: Partial<CorrectionDraft>) => onChange({ ...draft, ...partial })
  const patchPerson = (index: number, partial: Partial<DraftPerson>) =>
    patch({ persons: draft.persons.map((p, i) => (i === index ? { ...p, ...partial } : p)) })
  const patchItem = (key: string, partial: Partial<DraftItem>) =>
    patch({ items: draft.items.map((it) => (it.key === key ? { ...it, ...partial } : it)) })
  const removeItem = (key: string) => patch({ items: draft.items.filter((it) => it.key !== key) })
  const addItem = () => {
    nextKey.current += 1
    const workshop = draft.items[draft.items.length - 1]?.workshop ?? workshops[0] ?? "holz"
    patch({ items: [...draft.items, newItemRow(workshop, `${idPrefix}-new-${nextKey.current}`)] })
  }
  const workshopOptions = [...new Set([...workshops, ...draft.items.map((i) => i.workshop)])]
  const numberValue = (n: number) => (Number.isFinite(n) ? n : 0)

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Personen</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Nutzungsgebühr heute bereits bezahlt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.persons.map((person, i) => (
              <TableRow key={`${person.userId ?? person.name}-${i}`}>
                <TableCell className="font-medium">{person.name}</TableCell>
                <TableCell>
                  <Select
                    value={person.userType}
                    onValueChange={(v) => patchPerson(i, { userType: v as UserType })}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-40" aria-label={`Typ ${person.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(USER_TYPE_LABELS) as UserType[]).map((ut) => (
                        <SelectItem key={ut} value={ut}>
                          {USER_TYPE_LABELS[ut]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={person.entryFeeWaivedToday}
                    onCheckedChange={(v) => patchPerson(i, { entryFeeWaivedToday: v === true })}
                    disabled={disabled}
                    aria-label={`Nutzungsgebühr heute bereits bezahlt: ${person.name}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-wrap items-end gap-6">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-usage`}>Nutzungsart</Label>
          <Select
            value={draft.usageType}
            onValueChange={(v) => patch({ usageType: v as UsageType })}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-usage`} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {USAGE_TYPES.map((ut) => (
                <SelectItem key={ut} value={ut}>
                  {USAGE_TYPE_LABELS[ut] ?? ut}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-tip`}>Trinkgeld</Label>
          <Input
            id={`${idPrefix}-tip`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.05"
            className="w-32 text-right tabular-nums"
            value={numberValue(draft.tip)}
            onChange={(e) => patch({ tip: e.target.valueAsNumber || 0 })}
            disabled={disabled}
          />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Positionen ({draft.items.length})</h3>
          <Button type="button" variant="outline" size="sm" onClick={addItem} disabled={disabled}>
            <Plus className="mr-1 h-4 w-4" />
            Position hinzufügen
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">Bezeichnung</TableHead>
              <TableHead>Werkstatt</TableHead>
              <TableHead>Art</TableHead>
              <TableHead className="text-right">Menge</TableHead>
              <TableHead className="text-right">Einzelpreis</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Keine Positionen — nur die Nutzungsgebühr wird verrechnet.
                </TableCell>
              </TableRow>
            )}
            {draft.items.map((item, i) => (
              <TableRow key={item.key}>
                <TableCell>
                  <Input
                    aria-label={`Bezeichnung Position ${i + 1}`}
                    value={item.description}
                    onChange={(e) => patchItem(item.key, { description: e.target.value })}
                    disabled={disabled}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={item.workshop}
                    onValueChange={(v) => patchItem(item.key, { workshop: v })}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-32" aria-label={`Werkstatt Position ${i + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workshopOptions.map((w) => (
                        <SelectItem key={w} value={w}>
                          {w}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={item.type}
                    onValueChange={(v) => patchItem(item.key, { type: v as DraftItem["type"] })}
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-32" aria-label={`Art Position ${i + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="material">Material</SelectItem>
                      <SelectItem value="machine">Maschine</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    aria-label={`Menge Position ${i + 1}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="w-24 text-right tabular-nums"
                    value={numberValue(item.quantity)}
                    onChange={(e) => patchItem(item.key, { quantity: numberValue(e.target.valueAsNumber) })}
                    disabled={disabled}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    aria-label={`Einzelpreis Position ${i + 1}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.05"
                    className="w-28 text-right tabular-nums"
                    value={numberValue(item.unitPrice)}
                    onChange={(e) => patchItem(item.key, { unitPrice: numberValue(e.target.valueAsNumber) })}
                    disabled={disabled}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCHF(rowTotal(item))}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Position ${i + 1} entfernen`}
                    onClick={() => removeItem(item.key)}
                    disabled={disabled}
                  >
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
