// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useDb } from "@modules/lib/firebase-context"
import { userRef } from "@modules/lib/firestore-helpers"
import { parseSwissPhone } from "@modules/lib/phone"
import { isValidSwissPlz } from "@modules/lib/postal"
import { Label } from "@modules/components/ui/label"
import { Checkbox } from "@modules/components/ui/checkbox"
import {
  SectionDivider,
  SectionEyebrow,
} from "@modules/components/profile-form"
import { ArrowRight, Loader2, Mail, MapPin } from "lucide-react"
import { serverTimestamp } from "firebase/firestore"
import { useForm, Controller } from "react-hook-form"
import { USER_TYPE_LABELS, type UserType } from "@modules/lib/pricing"
import { cn } from "@modules/lib/utils"

const completeProfileSearchSchema = z.object({
  redirect: z.optional(z.string()),
})

export const Route = createFileRoute("/_authonly/account/complete-profile")({
  validateSearch: completeProfileSearchSchema,
  component: CompleteProfilePage,
})

interface CompleteProfileFormValues {
  firstName: string
  lastName: string
  userType: UserType
  company: string
  street: string
  zip: string
  city: string
  phone: string
  termsAccepted: boolean
}

const INPUT_BASE =
  "block w-full h-10 rounded-md border bg-background px-3 text-sm shadow-xs outline-none transition-colors"
const INPUT_OK = `${INPUT_BASE} border-[#ccc] focus:border-cog-teal focus:ring-2 focus:ring-cog-teal/30`
const INPUT_ERR = `${INPUT_BASE} border-destructive focus:border-destructive focus:ring-2 focus:ring-destructive/30`

function ErrorBadge({ message }: { message: string }) {
  return (
    <span className="block w-full mt-1 text-xs text-destructive">
      {message}
    </span>
  )
}

function CompleteProfilePage() {
  const db = useDb()
  const { userDoc } = useAuth()
  const { update, loading: saving } = useFirestoreMutation()
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors, isSubmitted },
  } = useForm<CompleteProfileFormValues>({
    defaultValues: {
      firstName: "",
      lastName: "",
      userType: "erwachsen",
      company: "",
      street: "",
      zip: "",
      city: "",
      phone: "",
      termsAccepted: false,
    },
  })

  const userType = watch("userType")
  const isFirma = userType === "firma"
  const profileComplete = userDoc ? isProfileComplete(userDoc) : false

  // Cache the parsed E.164 phone result from validation so we don't have to
  // parse twice (validate → submit). `useRef` keeps it stable across renders
  // without triggering re-validation.
  const normalisedPhoneRef = useRef<string | null>(null)

  useEffect(() => {
    if (profileComplete) {
      // Fall back to the root dispatcher (not /visit): a freshly signed-up
      // account has no open checkout, so the dispatcher sends them to
      // /checkin to start one instead of stranding them on the /visit
      // "Kein offener Besuch" gate. Users who do have a checkout still
      // resume on the right step.
      navigate({ to: redirectTo || "/" })
    }
  }, [profileComplete, navigate, redirectTo])

  if (profileComplete) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const fieldCls = (field: keyof CompleteProfileFormValues) =>
    isSubmitted && errors[field] ? INPUT_ERR : INPUT_OK

  const onSubmit = async (values: CompleteProfileFormValues) => {
    if (!userDoc) return
    await update(
      userRef(db, userDoc.id),
      {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        userType: values.userType,
        // Phone was already parsed + normalised during validation; use the
        // cached E.164 form. Empty input is stored as `null` (matches
        // `UserDoc.phone: string | null`).
        phone: normalisedPhoneRef.current,
        billingAddress: {
          company: values.userType === "firma" ? values.company.trim() : "",
          street: values.street.trim(),
          zip: values.zip.trim(),
          city: values.city.trim(),
        },
        termsAcceptedAt: serverTimestamp(),
      },
      { successMessage: "Profil gespeichert" },
    )
    // See the redirect note above: dispatcher, not /visit, so a new account
    // lands on /checkin to start a checkout.
    navigate({ to: redirectTo || "/" })
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl leading-tight">
          Profil vervollständigen
        </h1>
        <p className="text-sm text-muted-foreground">
          Damit wir Rechnungen ausstellen können, brauchen wir noch ein paar
          Angaben.
        </p>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="rounded-2xl border border-border bg-card shadow-xs p-6 sm:p-7 flex flex-col gap-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="firstName" className="text-sm font-bold">
              Vorname
            </Label>
            <input
              id="firstName"
              {...register("firstName", {
                validate: (v) =>
                  v.trim() !== "" || "Vorname ist erforderlich",
              })}
              className={fieldCls("firstName")}
              autoComplete="given-name"
            />
            {isSubmitted && errors.firstName && (
              <ErrorBadge message={errors.firstName.message!} />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="lastName" className="text-sm font-bold">
              Nachname
            </Label>
            <input
              id="lastName"
              {...register("lastName", {
                validate: (v) =>
                  v.trim() !== "" || "Nachname ist erforderlich",
              })}
              className={fieldCls("lastName")}
              autoComplete="family-name"
            />
            {isSubmitted && errors.lastName && (
              <ErrorBadge message={errors.lastName.message!} />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-sm font-bold">Nutzer:in</Label>
          <div className="flex gap-6 flex-wrap pt-1.5">
            {(Object.entries(USER_TYPE_LABELS) as [UserType, string][]).map(
              ([value, label]) => (
                <label
                  key={value}
                  className="inline-flex items-center gap-2 text-sm cursor-pointer select-none"
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center h-[18px] w-[18px] rounded-full border-[1.5px] transition-colors",
                      userType === value
                        ? "border-cog-teal bg-cog-teal"
                        : "border-[#c1c1c1] bg-background",
                    )}
                  >
                    {userType === value && (
                      <span className="h-2 w-2 rounded-full bg-white" />
                    )}
                  </span>
                  <input
                    type="radio"
                    value={value}
                    {...register("userType")}
                    className="sr-only"
                  />
                  {label}
                </label>
              ),
            )}
          </div>
        </div>

        {isFirma && (
          <div className="flex flex-col gap-1">
            <Label className="text-sm font-bold">Firmenname</Label>
            <input
              {...register("company", {
                validate: (v) =>
                  !isFirma || v.trim() !== "" || "Firmenname ist erforderlich",
              })}
              className={fieldCls("company")}
              placeholder="Holzbau Müller AG"
              autoComplete="organization"
            />
            {isSubmitted && errors.company && (
              <ErrorBadge message={errors.company.message!} />
            )}
          </div>
        )}

        <SectionDivider />
        <SectionEyebrow icon={<MapPin className="h-3 w-3" />}>
          Adresse
        </SectionEyebrow>

        <div className="flex flex-col gap-1">
          <Label className="text-sm font-bold">Strasse und Hausnummer</Label>
          <input
            {...register("street", {
              validate: (v) => v.trim() !== "" || "Strasse ist erforderlich",
            })}
            className={fieldCls("street")}
            placeholder="Seestrasse 12"
            autoComplete="street-address"
          />
          {isSubmitted && errors.street && (
            <ErrorBadge message={errors.street.message!} />
          )}
        </div>

        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
          <div className="flex flex-col gap-1">
            <Label className="text-sm font-bold">PLZ</Label>
            <input
              {...register("zip", {
                validate: (v) => {
                  if (v.trim() === "") return "PLZ ist erforderlich"
                  if (!isValidSwissPlz(v))
                    return "PLZ muss vierstellig sein (z.B. 8820)"
                  return true
                },
              })}
              className={`${fieldCls("zip")} tabular-nums`}
              placeholder="8820"
              maxLength={4}
              inputMode="numeric"
              autoComplete="postal-code"
            />
            {isSubmitted && errors.zip && (
              <ErrorBadge message={errors.zip.message!} />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-sm font-bold">Ort</Label>
            <input
              {...register("city", {
                validate: (v) => v.trim() !== "" || "Ort ist erforderlich",
              })}
              className={fieldCls("city")}
              placeholder="Wädenswil"
              autoComplete="address-level2"
            />
            {isSubmitted && errors.city && (
              <ErrorBadge message={errors.city.message!} />
            )}
          </div>
        </div>

        <SectionDivider />
        <SectionEyebrow icon={<Mail className="h-3 w-3" />}>
          Kontakt
        </SectionEyebrow>

        <div className="flex flex-col gap-1">
          <Label className="text-sm font-bold">
            Telefon{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </Label>
          <input
            {...register("phone", {
              validate: async (v) => {
                // Optional field: empty is fine. Non-empty must parse as a
                // Swiss phone number (libphonenumber-js, lazy-loaded).
                const result = await parseSwissPhone(v)
                if (result.ok) {
                  normalisedPhoneRef.current = result.e164
                  return true
                }
                if (result.reason === "empty") {
                  normalisedPhoneRef.current = null
                  return true
                }
                normalisedPhoneRef.current = null
                return "Bitte gib eine gültige Schweizer Telefonnummer ein (z.B. +41 79 123 45 67)"
              },
            })}
            type="tel"
            className={fieldCls("phone")}
            placeholder="+41 79 123 45 67"
            autoComplete="tel"
          />
          {isSubmitted && errors.phone && (
            <ErrorBadge message={errors.phone.message!} />
          )}
        </div>

        <Controller
          name="termsAccepted"
          control={control}
          rules={{
            validate: (v) =>
              v || "Du musst die Nutzungsbestimmungen akzeptieren",
          }}
          render={({ field }) => (
            <div className="mt-1 pt-5 border-t border-border flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="termsAccepted"
                  className="bg-white"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                <label
                  htmlFor="termsAccepted"
                  className="text-sm leading-snug"
                >
                  Ich akzeptiere die{" "}
                  <a
                    href="https://werkstattwaedi.ch/nutzungsbestimmungen"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="underline font-bold text-cog-teal"
                  >
                    Nutzungsbestimmungen
                  </a>
                </label>
              </div>
              {isSubmitted && errors.termsAccepted && (
                <ErrorBadge message={errors.termsAccepted.message!} />
              )}
            </div>
          )}
        />

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-cog-teal rounded-md hover:bg-cog-teal-dark transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Profil speichern
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  )
}

