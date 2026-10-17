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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@modules/components/ui/tooltip"
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
  const [reasonOpen, setReasonOpen] = useState(false)
  const disabled = disabledReason !== undefined
  const reasonId = useId()

  if (savedPersons.length === 0 || disabled) {
    const button = (
      <button
        type="button"
        // Disabled: the wrapper below takes the pointer, so hover and tap
        // reach the tooltip trigger instead of dying on the disabled button.
        className={disabled ? `${TRIGGER} pointer-events-none` : TRIGGER}
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
    // A disabled button fires no pointer or focus events, so a focusable
    // wrapper is the tooltip's trigger: hover and keyboard focus open it on
    // desktop. Radix tooltips ignore touch, and kiosk touchscreens can't
    // hover — a tap opens it (preventDefault keeps Radix's close-on-press
    // from undoing that), a tap anywhere else closes it. The hidden copy
    // keeps the reason announced with the button without opening anything.
    return (
      <TooltipProvider>
        <Tooltip open={reasonOpen} onOpenChange={setReasonOpen}>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              data-testid="add-person-disabled"
              className="inline-flex cursor-not-allowed rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cog-teal"
              onPointerDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault()
                setReasonOpen(true)
              }}
            >
              {button}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" sideOffset={6}>
            {disabledReason}
          </TooltipContent>
        </Tooltip>
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      </TooltipProvider>
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

