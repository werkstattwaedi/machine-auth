// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  USER_TYPE_LABELS,
  USAGE_TYPE_LABELS,
  type UserType,
  type UsageType,
} from "@/lib/pricing"
import { formatCHF } from "@/lib/format"
import { X } from "lucide-react"
import type { CheckoutPerson, CheckoutAction } from "./use-checkout-state"

interface PersonCardProps {
  person: CheckoutPerson
  index: number
  isOnly: boolean
  showTerms: boolean
  dispatch: React.Dispatch<CheckoutAction>
}

export function PersonCard({
  person,
  index,
  isOnly,
  dispatch,
}: PersonCardProps) {
  const update = (updates: Partial<CheckoutPerson>) =>
    dispatch({ type: "UPDATE_PERSON", id: person.id, updates })

  const showBillingAddress = person.userType === "firma"

  return (
    <div className="bg-[rgba(204,204,204,0.2)] rounded-none p-[25px] space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold font-body">
          Person {index + 1}
        </h3>
        {!isOnly && !person.isPreFilled && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={() =>
              dispatch({ type: "REMOVE_PERSON", id: person.id })
            }
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {person.isPreFilled ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-sm font-bold">Vorname</Label>
            <p className="text-sm">{person.firstName}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-bold">Nachname</Label>
            <p className="text-sm">{person.lastName}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-bold">E-Mail</Label>
            <p className="text-sm">{person.email}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-sm font-bold">
              Vorname<span className="text-[#cc2a24]">*</span>
            </Label>
            <input
              value={person.firstName}
              onChange={(e) => update({ firstName: e.target.value })}
              className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-bold">
              Nachname<span className="text-[#cc2a24]">*</span>
            </Label>
            <input
              value={person.lastName}
              onChange={(e) => update({ lastName: e.target.value })}
              className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-bold">
              E-Mail<span className="text-[#cc2a24]">*</span>
            </Label>
            <input
              type="email"
              value={person.email}
              onChange={(e) => update({ email: e.target.value })}
              className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <Label className="text-sm font-bold">Nutzer:in</Label>
          <div className="flex gap-3 pt-1">
            {(Object.entries(USER_TYPE_LABELS) as [UserType, string][]).map(
              ([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name={`userType-${person.id}`}
                    checked={person.userType === value}
                    onChange={() => update({ userType: value })}
                    className="accent-cog-teal"
                    disabled={person.isPreFilled}
                  />
                  {label}
                </label>
              )
            )}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-bold">Nutzungsart</Label>
          <select
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm"
            value={person.usageType}
            onChange={(e) =>
              update({ usageType: e.target.value as UsageType })
            }
          >
            {(
              Object.entries(USAGE_TYPE_LABELS) as [UsageType, string][]
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-bold">Nutzungsgebühr</Label>
          <p className="text-sm pt-1">{formatCHF(person.fee)}</p>
        </div>
      </div>

      {/* Billing address for Firma */}
      {showBillingAddress && (
        <div className="space-y-3 border-t pt-4">
          <Label className="text-sm font-bold">Rechnungsadresse</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-sm">Firma<span className="text-[#cc2a24]">*</span></Label>
              <input
                value={(person as any).billingCompany ?? ""}
                onChange={(e) => update({ billingCompany: e.target.value } as any)}
                className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Strasse / Nr.<span className="text-[#cc2a24]">*</span></Label>
              <input
                value={(person as any).billingStreet ?? ""}
                onChange={(e) => update({ billingStreet: e.target.value } as any)}
                className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">PLZ<span className="text-[#cc2a24]">*</span></Label>
              <input
                value={(person as any).billingZip ?? ""}
                onChange={(e) => update({ billingZip: e.target.value } as any)}
                className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Ort<span className="text-[#cc2a24]">*</span></Label>
              <input
                value={(person as any).billingCity ?? ""}
                onChange={(e) => update({ billingCity: e.target.value } as any)}
                className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
