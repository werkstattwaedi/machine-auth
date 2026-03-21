// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  USER_TYPE_LABELS,
  type UserType,
} from "@/lib/pricing"
import { X } from "lucide-react"
import type { CheckoutPerson, CheckoutAction } from "./use-checkout-state"

interface PersonCardProps {
  person: CheckoutPerson
  index: number
  isOnly: boolean
  showTerms: boolean
  dispatch: React.Dispatch<CheckoutAction>
  errors?: Record<string, string>
  touched?: Record<string, boolean>
  submitted?: boolean
  onBlur?: (field: string) => void
}

function showError(
  field: string,
  errors?: Record<string, string>,
  touched?: Record<string, boolean>,
  submitted?: boolean,
): string | null {
  const msg = errors?.[field]
  if (!msg) return null
  if (submitted || touched?.[field]) return msg
  return null
}

const BASE_INPUT =
  "flex h-9 w-full rounded-none border bg-background px-3 py-1 text-sm outline-none"
const INPUT_OK = `${BASE_INPUT} border-[#ccc] focus:border-cog-teal`
const INPUT_ERR = `${BASE_INPUT} border-[#cc2a24] focus:border-[#cc2a24]`

function ErrorBadge({ message }: { message: string }) {
  return (
    <span className="inline-block mt-1 px-2 py-0.5 text-xs text-white bg-[#cc2a24] rounded-sm">
      {message}
    </span>
  )
}

export function PersonCard({
  person,
  index,
  isOnly,
  dispatch,
  errors,
  touched,
  submitted,
  onBlur,
}: PersonCardProps) {
  const update = (updates: Partial<CheckoutPerson>) =>
    dispatch({ type: "UPDATE_PERSON", id: person.id, updates })

  const showBillingAddress = person.userType === "firma"

  const err = (field: string) => showError(field, errors, touched, submitted)
  const fieldCls = (field: string) => (err(field) ? INPUT_ERR : INPUT_OK)
  const wrapCls = (field: string) =>
    `space-y-1${err(field) ? " bg-[#fce4e4] p-2 -m-2 rounded-sm" : ""}`

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
          <div className={wrapCls("firstName")}>
            <Label className="text-sm font-bold">
              Vorname<span className="text-[#cc2a24]">*</span>
            </Label>
            <input
              value={person.firstName}
              onChange={(e) => update({ firstName: e.target.value })}
              onBlur={() => onBlur?.("firstName")}
              className={fieldCls("firstName")}
            />
            {err("firstName") && <ErrorBadge message={err("firstName")!} />}
          </div>
          <div className={wrapCls("lastName")}>
            <Label className="text-sm font-bold">
              Nachname<span className="text-[#cc2a24]">*</span>
            </Label>
            <input
              value={person.lastName}
              onChange={(e) => update({ lastName: e.target.value })}
              onBlur={() => onBlur?.("lastName")}
              className={fieldCls("lastName")}
            />
            {err("lastName") && <ErrorBadge message={err("lastName")!} />}
          </div>
          <div className={wrapCls("email")}>
            <Label className="text-sm font-bold">
              E-Mail<span className="text-[#cc2a24]">*</span>
            </Label>
            <input
              value={person.email}
              onChange={(e) => update({ email: e.target.value })}
              onBlur={() => onBlur?.("email")}
              className={fieldCls("email")}
            />
            {err("email") && <ErrorBadge message={err("email")!} />}
          </div>
        </div>
      )}

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

      {/* Billing address for Firma */}
      {showBillingAddress && (
        <div className="space-y-3 border-t pt-4">
          <Label className="text-sm font-bold">Rechnungsadresse</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className={wrapCls("billingCompany")}>
              <Label className="text-sm">Firma<span className="text-[#cc2a24]">*</span></Label>
              <input
                value={person.billingCompany ?? ""}
                onChange={(e) => update({ billingCompany: e.target.value })}
                onBlur={() => onBlur?.("billingCompany")}
                className={fieldCls("billingCompany")}
              />
              {err("billingCompany") && <ErrorBadge message={err("billingCompany")!} />}
            </div>
            <div className={wrapCls("billingStreet")}>
              <Label className="text-sm">Strasse / Nr.<span className="text-[#cc2a24]">*</span></Label>
              <input
                value={person.billingStreet ?? ""}
                onChange={(e) => update({ billingStreet: e.target.value })}
                onBlur={() => onBlur?.("billingStreet")}
                className={fieldCls("billingStreet")}
              />
              {err("billingStreet") && <ErrorBadge message={err("billingStreet")!} />}
            </div>
            <div className={wrapCls("billingZip")}>
              <Label className="text-sm">PLZ<span className="text-[#cc2a24]">*</span></Label>
              <input
                value={person.billingZip ?? ""}
                onChange={(e) => update({ billingZip: e.target.value })}
                onBlur={() => onBlur?.("billingZip")}
                className={fieldCls("billingZip")}
              />
              {err("billingZip") && <ErrorBadge message={err("billingZip")!} />}
            </div>
            <div className={wrapCls("billingCity")}>
              <Label className="text-sm">Ort<span className="text-[#cc2a24]">*</span></Label>
              <input
                value={person.billingCity ?? ""}
                onChange={(e) => update({ billingCity: e.target.value })}
                onBlur={() => onBlur?.("billingCity")}
                className={fieldCls("billingCity")}
              />
              {err("billingCity") && <ErrorBadge message={err("billingCity")!} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
