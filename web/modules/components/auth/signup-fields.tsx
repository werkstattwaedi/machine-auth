// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The inline sign-up form for the combined login page. Captures the minimum
 * needed to create an account: first/last name, member type, terms — plus,
 * for a company (`firma`), the billing address (it always invoices). When the
 * user arrived via the e-mail-code path the 6-digit code is entered inline
 * here (where Galaxus puts the password); Google / magic-link arrivals have
 * already proven the e-mail and omit the code.
 *
 * Controlled component: the parent (LoginPage) owns the state, validation, and
 * submit. This just renders fields and surfaces errors.
 */

import { Label } from "@modules/components/ui/label"
import { Checkbox } from "@modules/components/ui/checkbox"
import {
  INPUT_OK,
  INPUT_ERR,
  ErrorBadge,
  SectionDivider,
  AddressFields,
} from "@modules/components/profile-form"
import { USER_TYPE_LABELS, type UserType } from "@modules/lib/pricing"
import { EMPTY_ADDRESS, type AddressValue, type AddressErrors } from "@modules/lib/address"
import { cn } from "@modules/lib/utils"

export interface SignupFieldsValue {
  firstName: string
  lastName: string
  userType: UserType
  /** Only meaningful when `showCode` — the inline 6-digit code. */
  code: string
  termsAccepted: boolean
  address: AddressValue
}

export interface SignupFieldsErrors {
  firstName?: string
  lastName?: string
  code?: string
  termsAccepted?: string
  address?: AddressErrors
}

export const EMPTY_SIGNUP_VALUE: SignupFieldsValue = {
  firstName: "",
  lastName: "",
  userType: "erwachsen",
  code: "",
  termsAccepted: false,
  address: EMPTY_ADDRESS,
}

export function SignupFields({
  value,
  errors,
  onChange,
  showCode,
}: {
  value: SignupFieldsValue
  errors?: SignupFieldsErrors
  onChange: (patch: Partial<SignupFieldsValue>) => void
  /** Show the inline 6-digit code field (e-mail-code sign-up). */
  showCode: boolean
}) {
  const isFirma = value.userType === "firma"
  const cls = (field: "firstName" | "lastName") =>
    errors?.[field] ? INPUT_ERR : INPUT_OK

  return (
    <div className="flex flex-col gap-5 text-left">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="signup-firstname" className="text-sm font-bold">
            Vorname
          </Label>
          <input
            id="signup-firstname"
            data-testid="signup-firstname"
            value={value.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            className={cls("firstName")}
            autoComplete="given-name"
          />
          {errors?.firstName && <ErrorBadge message={errors.firstName} />}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="signup-lastname" className="text-sm font-bold">
            Nachname
          </Label>
          <input
            id="signup-lastname"
            data-testid="signup-lastname"
            value={value.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            className={cls("lastName")}
            autoComplete="family-name"
          />
          {errors?.lastName && <ErrorBadge message={errors.lastName} />}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-sm font-bold">Nutzer:in</Label>
        <div className="flex gap-6 flex-wrap pt-1.5">
          {(Object.entries(USER_TYPE_LABELS) as [UserType, string][]).map(
            ([type, label]) => (
              <label
                key={type}
                className="inline-flex items-center gap-2 text-sm cursor-pointer select-none"
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center h-[18px] w-[18px] rounded-full border-[1.5px] transition-colors",
                    value.userType === type
                      ? "border-cog-teal bg-cog-teal"
                      : "border-[#c1c1c1] bg-background",
                  )}
                >
                  {value.userType === type && (
                    <span className="h-2 w-2 rounded-full bg-white" />
                  )}
                </span>
                <input
                  type="radio"
                  name="signup-membertype"
                  value={type}
                  data-testid={`signup-membertype-${type}`}
                  checked={value.userType === type}
                  onChange={() => onChange({ userType: type })}
                  className="sr-only"
                />
                {label}
              </label>
            ),
          )}
        </div>
      </div>

      {isFirma && (
        <>
          <SectionDivider />
          <AddressFields
            value={value.address}
            errors={errors?.address}
            onChange={(patch) =>
              onChange({ address: { ...value.address, ...patch } })
            }
            includeCompany
            idPrefix="signup-addr"
          />
        </>
      )}

      {showCode && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="signup-code" className="text-sm font-bold">
            Code aus der E-Mail
          </Label>
          <input
            id="signup-code"
            data-testid="signup-code-input"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder="123456"
            value={value.code}
            onChange={(e) =>
              onChange({ code: e.target.value.replace(/\D/g, "") })
            }
            className={`${errors?.code ? INPUT_ERR : INPUT_OK} text-center text-xl tracking-widest`}
            aria-label="6-stelliger Code"
          />
          {errors?.code && <ErrorBadge message={errors.code} />}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <Checkbox
            id="signup-terms"
            data-testid="signup-terms"
            className="bg-white"
            checked={value.termsAccepted}
            onCheckedChange={(checked) =>
              onChange({ termsAccepted: checked === true })
            }
          />
          <label htmlFor="signup-terms" className="text-sm leading-snug">
            Ich akzeptiere die{" "}
            <a
              href="https://werkstattwaedi.ch/nutzungsbestimmungen"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-bold text-cog-teal"
            >
              Nutzungsbestimmungen
            </a>
          </label>
        </div>
        {errors?.termsAccepted && (
          <ErrorBadge message={errors.termsAccepted} />
        )}
      </div>
    </div>
  )
}
