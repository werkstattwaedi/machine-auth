// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared layout primitives for profile-style forms (Profil page +
 * Komplett-Profil-Onboarding). Extracted so the visual contract — the
 * soft section divider and the small uppercase eyebrow with a leading
 * icon — stays in one place as more profile-shaped surfaces are added
 * (e.g. admin user editor).
 */

import type { ReactNode } from "react"
import { Label } from "@modules/components/ui/label"
import { MapPin } from "lucide-react"
import type { AddressValue, AddressErrors } from "@modules/lib/address"

// 16px on mobile: iOS Safari auto-zooms (and stays zoomed) when a focused
// control's font-size is below 16px. See issue #492.
const INPUT_BASE =
  "block w-full h-10 rounded-md border bg-background px-3 text-base md:text-sm shadow-xs outline-none transition-colors"
export const INPUT_OK = `${INPUT_BASE} border-[#ccc] focus:border-cog-teal focus:ring-2 focus:ring-cog-teal/30`
export const INPUT_ERR = `${INPUT_BASE} border-destructive focus:border-destructive focus:ring-2 focus:ring-destructive/30`

export function ErrorBadge({ message }: { message: string }) {
  return (
    <span className="block w-full mt-1 text-xs text-destructive">
      {message}
    </span>
  )
}

export function SectionDivider() {
  return <hr className="border-t border-black/10" />
}

export function SectionEyebrow({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="-mt-1 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      {icon}
      {children}
    </div>
  )
}

/**
 * Controlled postal-address sub-form (company optional via `includeCompany`).
 * Used by the sign-up firma address and the checkout membership line item —
 * surfaces that bind to plain component state rather than react-hook-form.
 * Validation is the caller's job (see `validateAddress` in `@modules/lib/address`).
 */
export function AddressFields({
  value,
  errors,
  onChange,
  includeCompany = false,
  showEyebrow = true,
  idPrefix = "addr",
}: {
  value: AddressValue
  errors?: AddressErrors
  onChange: (patch: Partial<AddressValue>) => void
  includeCompany?: boolean
  showEyebrow?: boolean
  idPrefix?: string
}) {
  const cls = (field: keyof AddressValue) =>
    errors?.[field] ? INPUT_ERR : INPUT_OK
  return (
    <div className="flex flex-col gap-4">
      {showEyebrow && (
        <SectionEyebrow icon={<MapPin className="h-3 w-3" />}>
          Adresse
        </SectionEyebrow>
      )}
      {includeCompany && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-company`} className="text-sm font-bold">
            Firmenname
          </Label>
          <input
            id={`${idPrefix}-company`}
            value={value.company}
            onChange={(e) => onChange({ company: e.target.value })}
            className={cls("company")}
            placeholder="Holzbau Müller AG"
            autoComplete="organization"
          />
          {errors?.company && <ErrorBadge message={errors.company} />}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-street`} className="text-sm font-bold">
          Strasse und Hausnummer
        </Label>
        <input
          id={`${idPrefix}-street`}
          value={value.street}
          onChange={(e) => onChange({ street: e.target.value })}
          className={cls("street")}
          placeholder="Seestrasse 12"
          autoComplete="street-address"
        />
        {errors?.street && <ErrorBadge message={errors.street} />}
      </div>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-zip`} className="text-sm font-bold">
            PLZ
          </Label>
          <input
            id={`${idPrefix}-zip`}
            value={value.zip}
            onChange={(e) => onChange({ zip: e.target.value })}
            className={`${cls("zip")} tabular-nums`}
            placeholder="8820"
            maxLength={4}
            inputMode="numeric"
            autoComplete="postal-code"
          />
          {errors?.zip && <ErrorBadge message={errors.zip} />}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-city`} className="text-sm font-bold">
            Ort
          </Label>
          <input
            id={`${idPrefix}-city`}
            value={value.city}
            onChange={(e) => onChange({ city: e.target.value })}
            className={cls("city")}
            placeholder="Wädenswil"
            autoComplete="address-level2"
          />
          {errors?.city && <ErrorBadge message={errors.city} />}
        </div>
      </div>
    </div>
  )
}
