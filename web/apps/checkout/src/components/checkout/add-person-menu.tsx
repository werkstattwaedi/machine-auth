// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useId, useState } from "react"
import { ChevronDown, Plus, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modules/components/ui/dropdown-menu"
import type { SavedPersonEntry } from "./use-checkout-state"

const TRIGGER =
  "inline-flex items-center gap-2 rounded-md border border-cog-teal bg-white px-4 py-2.5 text-sm font-semibold text-cog-teal-dark transition-colors hover:bg-cog-teal-light disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:hover:bg-white"

interface AddPersonMenuProps {
  /** Saved persons not on the visit yet; empty = a plain button. */
  savedPersons: readonly SavedPersonEntry[]
  onAddNew: () => void
  onAddSaved: (saved: SavedPersonEntry) => void
  /**
   * Delete a saved person. Rejects when the write failed (the mutation hook
   * already toasted) — the confirmation then stays open for a retry.
   */
  onDeleteSaved: (saved: SavedPersonEntry) => Promise<void>
  /**
   * Why no person can be added right now (an owner-only usage type is
   * selected, CHK-32); undefined = enabled.
   */
  disabledReason?: string
  /** The menu (and with it a delete confirmation) opened — a touch on the kiosk. */
  onOpen?: () => void
}

/**
 * "Person hinzufügen" on the check-in (issue #605). With saved persons it
 * opens a menu: the saved persons not on the visit (each with a bin to stop
 * suggesting them), then "+ Neue Person". Without any it stays the plain
 * button. Removing asks inline, inside the open menu.
 */
export function AddPersonMenu({
  savedPersons,
  onAddNew,
  onAddSaved,
  onDeleteSaved,
  disabledReason,
  onOpen,
}: AddPersonMenuProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const disabled = disabledReason !== undefined
  const reasonId = useId()

  if (savedPersons.length === 0 || disabled) {
    const button = (
      <button
        type="button"
        className={TRIGGER}
        onClick={onAddNew}
        disabled={disabled}
        aria-describedby={disabled ? reasonId : undefined}
        data-testid="add-person"
      >
        <Plus className="h-4 w-4" />
        Person hinzufügen
        {savedPersons.length > 0 && <ChevronDown className="h-4 w-4" />}
      </button>
    )
    if (!disabled) return button
    // Kiosk touchscreens can't hover: the reason sits visibly under the
    // button, and the button points at it for screen readers.
    return (
      <div className="flex flex-col items-start gap-1.5">
        {button}
        <p
          id={reasonId}
          data-testid="add-person-disabled-reason"
          className="text-xs text-muted-foreground"
        >
          {disabledReason}
        </p>
      </div>
    )
  }

  const confirming = savedPersons.find((s) => s.id === confirmingId) ?? null

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onOpen?.()
        else setConfirmingId(null)
      }}
    >
      <DropdownMenuTrigger asChild>
        <button type="button" className={TRIGGER} data-testid="add-person">
          <Plus className="h-4 w-4" />
          Person hinzufügen
          <ChevronDown className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[300px] max-w-[calc(100vw-32px)] rounded-[10px] bg-white p-1.5"
      >
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Gespeichert
        </DropdownMenuLabel>
        {savedPersons.map((saved) => {
          const name = `${saved.firstName} ${saved.lastName}`.trim()
          return (
            <div key={saved.id} data-testid="saved-person-row">
              <div className="flex items-center gap-1">
                <DropdownMenuItem
                  className="flex-1 py-2.5 text-sm"
                  onSelect={() => onAddSaved(saved)}
                >
                  {name}
                </DropdownMenuItem>
                <DropdownMenuItem
                  aria-label={`${name} nicht mehr vorschlagen`}
                  className="h-9 w-9 justify-center p-0"
                  onSelect={(e) => {
                    // Keep the menu open: the confirmation renders inside it.
                    e.preventDefault()
                    setConfirmingId(saved.id)
                    onOpen?.()
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </DropdownMenuItem>
              </div>
              {confirming?.id === saved.id && (
                <div
                  data-testid="saved-person-confirm"
                  className="mx-1 mb-1.5 rounded-md border border-border bg-white p-3 text-sm"
                >
                  <p>
                    <b>{name}</b> nicht mehr vorschlagen?
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <DropdownMenuItem
                      className="rounded-md border border-border px-3 py-1.5 font-semibold"
                      onSelect={(e) => {
                        e.preventDefault()
                        setConfirmingId(null)
                      }}
                    >
                      Abbrechen
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={deleting}
                      className="rounded-md bg-destructive px-3 py-1.5 font-semibold text-white focus:bg-destructive/90 focus:text-white"
                      onSelect={(e) => {
                        e.preventDefault()
                        setDeleting(true)
                        onDeleteSaved(saved)
                          .then(() => setConfirmingId(null))
                          .catch(() => {
                            // Already toasted; keep the confirmation for a retry.
                          })
                          .finally(() => setDeleting(false))
                      }}
                    >
                      Entfernen
                    </DropdownMenuItem>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="py-2.5 text-sm font-semibold text-cog-teal-dark"
          onSelect={onAddNew}
        >
          <Plus className="h-4 w-4 text-cog-teal-dark" />
          Neue Person
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

