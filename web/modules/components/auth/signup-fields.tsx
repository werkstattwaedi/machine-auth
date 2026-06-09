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
import {
  EMPTY_ADDRESS,
  validateAddress,
  type AddressValue,
  type AddressErrors,
} from "@modules/lib/address"
import { type SignupProfile } from "@modules/lib/auth"
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

/** Validate the sign-up form. `requireCode` enforces the inline 6-digit code. */
export function validateSignupFields(
  value: SignupFieldsValue,
  { requireCode }: { requireCode: boolean }
): SignupFieldsErrors {
  const errs: SignupFieldsErrors = {}
  if (value.firstName.trim() === "") errs.firstName = "Vorname ist erforderlich"
  if (value.lastName.trim() === "") errs.lastName = "Nachname ist erforderlich"
  if (requireCode && value.code.length !== 6) {
    errs.code = "Bitte gib den 6-stelligen Code ein"
  }
  if (!value.termsAccepted) {
    errs.termsAccepted = "Du musst die Nutzungsbestimmungen akzeptieren"
  }
  if (value.userType === "firma") {
    const addrErrs = validateAddress(value.address, { requireCompany: true })
    if (Object.keys(addrErrs).length > 0) errs.address = addrErrs
  }
  return errs
}

/** Build the persisted profile (trimmed; firma address or null) from the form. */
export function signupProfileFrom(value: SignupFieldsValue): SignupProfile {
  return {
    firstName: value.firstName.trim(),
    lastName: value.lastName.trim(),
    userType: value.userType,
    termsAccepted: true,
    billingAddress:
      value.userType === "firma"
        ? {
            company: value.address.company.trim(),
            street: value.address.street.trim(),
            zip: value.address.zip.trim(),
            city: value.address.city.trim(),
          }
        : null,
  }
}

export function SignupFields({
  value,
  errors,
  onChange,
  showCode,
  email,
  emailAction,
  onResendCode,
}: {
  value: SignupFieldsValue
  errors?: SignupFieldsErrors
  onChange: (patch: Partial<SignupFieldsValue>) => void
  /** Show the inline 6-digit code field (e-mail-code sign-up). */
  showCode: boolean
  /** The account's e-mail, shown as a read-only field at the top. */
  email?: string
  /** Escape next to the e-mail field — "Ändern" (back to the e-mail stage)
   *  or "Abmelden" (drop a half-signed-in Google/magic-link session). */
  emailAction?: { label: string; onClick: () => void }
  /** Request a fresh code — shown under the code field so an expired code
   *  (5 min TTL) isn't a dead end. */
  onResendCode?: () => void
}) {
  const isFirma = value.userType === "firma"
  const cls = (field: "firstName" | "lastName") =>
    errors?.[field] ? INPUT_ERR : INPUT_OK

  return (
    <div className="flex flex-col gap-5 text-left">
      {email && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="signup-email" className="text-sm font-bold">
              E-Mail
            </Label>
            {emailAction && (
              <button
                type="button"
                onClick={emailAction.onClick}
                className="text-sm font-medium text-cog-teal-dark underline hover:no-underline"
              >
                {emailAction.label}
              </button>
            )}
          </div>
          <input
            id="signup-email"
            data-testid="signup-email"
            value={email}
            readOnly
            tabIndex={-1}
            className={`${INPUT_OK} bg-muted/50 text-muted-foreground focus:border-[#ccc] focus:ring-0`}
          />
        </div>
      )}

      {showCode && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="signup-code" className="text-sm font-bold">
            Bestätigungscode
            <span className="text-destructive -ml-1">*</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            Wir haben dir einen 6-stelligen Code an diese Adresse geschickt —
            so bestätigst du, dass die E-Mail-Adresse dir gehört.
          </p>
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
          {onResendCode && (
            <button
              type="button"
              onClick={onResendCode}
              data-testid="signup-resend-code"
              className="self-start mt-1 text-sm font-medium text-cog-teal-dark underline hover:no-underline"
            >
              Code erneut senden
            </button>
          )}
        </div>
      )}

      {/* Member type as a light segmented control (the round radios read
          heavy here). Placed before the name so a Firma flows naturally
          into its contact person + address. Hint above the control,
          matching the Bestätigungscode pattern. */}
      <div className="flex flex-col gap-1">
        <Label className="text-sm font-bold">Nutzer:in</Label>
        <p className="text-xs text-muted-foreground">
          Bestimmt den Eintrittspreis in der Werkstatt.
        </p>
        <div
          role="radiogroup"
          aria-label="Nutzer:in"
          className="grid grid-cols-3 rounded-md border border-[#ccc] overflow-hidden shadow-xs"
        >
          {(Object.entries(USER_TYPE_LABELS) as [UserType, string][]).map(
            ([type, label]) => (
              <label
                key={type}
                className={cn(
                  "flex items-center justify-center h-10 px-1 text-[13px] sm:text-sm text-center leading-tight cursor-pointer select-none transition-colors border-l border-[#ccc] first:border-l-0",
                  value.userType === type
                    ? "bg-cog-teal text-white font-semibold"
                    : "bg-background hover:bg-cog-teal-light",
                )}
              >
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

      <div className="flex flex-col gap-1">
        <Label htmlFor="signup-firstname" className="text-sm font-bold">
          Vorname
          <span className="text-destructive -ml-1">*</span>
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
          <span className="text-destructive -ml-1">*</span>
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
