// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@modules/lib/auth"
import { useCollection } from "@modules/lib/firestore"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useDb } from "@modules/lib/firebase-context"
import {
  permissionsCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import { Label } from "@modules/components/ui/label"
import { Badge } from "@modules/components/ui/badge"
import {
  SectionDivider,
  SectionEyebrow,
} from "@modules/components/profile-form"
import { useForm } from "react-hook-form"
import { Check, KeyRound, Loader2, Mail, MapPin, Save } from "lucide-react"
import { useEffect } from "react"
import { USER_TYPE_LABELS, type UserType } from "@modules/lib/pricing"
import { cn } from "@modules/lib/utils"

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
})

interface ProfileFormValues {
  firstName: string
  lastName: string
  userType: UserType
  company: string
  street: string
  zip: string
  city: string
  phone: string
}

const INPUT_BASE =
  "block w-full h-10 rounded-md border bg-background px-3 text-sm shadow-xs outline-none transition-colors"
const INPUT =
  `${INPUT_BASE} border-[#ccc] focus:border-cog-teal focus:ring-2 focus:ring-cog-teal/30`
const INPUT_ERR =
  `${INPUT_BASE} border-destructive focus:border-destructive focus:ring-2 focus:ring-destructive/30`
const INPUT_DISABLED =
  "block w-full h-10 rounded-md border border-[#ccc] bg-muted/50 px-3 text-sm text-muted-foreground cursor-not-allowed shadow-xs"

function ErrorText({ message }: { message?: string }) {
  if (!message) return null
  return <span className="text-xs text-destructive mt-0.5">{message}</span>
}

function ProfilePage() {
  const db = useDb()
  const { user, userDoc } = useAuth()
  const { update, loading: saving } = useFirestoreMutation()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isDirty, isSubmitSuccessful, errors, isSubmitted },
  } = useForm<ProfileFormValues>({
    defaultValues: {
      firstName: "",
      lastName: "",
      userType: "erwachsen",
      company: "",
      street: "",
      zip: "",
      city: "",
      phone: "",
    },
  })

  const userType = watch("userType")
  const isFirma = userType === "firma"
  const fieldCls = (field: keyof ProfileFormValues) =>
    isSubmitted && errors[field] ? INPUT_ERR : INPUT

  useEffect(() => {
    if (userDoc) {
      reset({
        firstName: userDoc.firstName,
        lastName: userDoc.lastName,
        userType: (userDoc.userType as UserType) ?? "erwachsen",
        company: userDoc.billingAddress?.company ?? "",
        street: userDoc.billingAddress?.street ?? "",
        zip: userDoc.billingAddress?.zip ?? "",
        city: userDoc.billingAddress?.city ?? "",
        phone: userDoc.phone ?? "",
      })
    }
  }, [userDoc, reset])

  const onSubmit = async (values: ProfileFormValues) => {
    if (!userDoc) return
    await update(
      userRef(db, userDoc.id),
      {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        userType: values.userType,
        phone: values.phone.trim() || null,
        billingAddress: {
          company: values.userType === "firma" ? values.company.trim() : "",
          street: values.street.trim(),
          zip: values.zip.trim(),
          city: values.city.trim(),
        },
      },
      { successMessage: "Profil gespeichert" },
    )
    // Reset dirty state to current values so the Save button disables again.
    reset(values, { keepValues: true })
  }

  const justSaved = !isDirty && isSubmitSuccessful

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl leading-tight">
          Profil
        </h1>
        <p className="text-sm text-muted-foreground">
          Kontaktdaten und Konto-Einstellungen.
        </p>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="rounded-2xl border border-border bg-card shadow-xs p-6 sm:p-7 flex flex-col gap-5"
      >
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <Label className="text-sm font-bold">Vorname</Label>
            <input
              {...register("firstName", {
                required: "Vorname ist erforderlich",
              })}
              className={fieldCls("firstName")}
              autoComplete="given-name"
            />
            <ErrorText message={errors.firstName?.message} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-sm font-bold">Nachname</Label>
            <input
              {...register("lastName", {
                required: "Nachname ist erforderlich",
              })}
              className={fieldCls("lastName")}
              autoComplete="family-name"
            />
            <ErrorText message={errors.lastName?.message} />
          </div>
        </div>

        {isFirma && (
          <div className="flex flex-col gap-1">
            <Label className="text-sm font-bold">Firmenname</Label>
            <input
              {...register("company", {
                validate: (v) =>
                  !isFirma ||
                  v.trim() !== "" ||
                  "Firmenname ist erforderlich",
              })}
              className={fieldCls("company")}
              autoComplete="organization"
            />
            <ErrorText message={errors.company?.message} />
          </div>
        )}

        <SectionDivider />
        <SectionEyebrow icon={<MapPin className="h-3 w-3" />}>
          Adresse
        </SectionEyebrow>

        <div className="flex flex-col gap-1">
          <Label className="text-sm font-bold">Strasse und Hausnummer</Label>
          <input
            {...register("street", { required: "Strasse ist erforderlich" })}
            className={fieldCls("street")}
            autoComplete="street-address"
          />
          <ErrorText message={errors.street?.message} />
        </div>

        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
          <div className="flex flex-col gap-1">
            <Label className="text-sm font-bold">PLZ</Label>
            <input
              {...register("zip", { required: "PLZ ist erforderlich" })}
              className={`${fieldCls("zip")} tabular-nums`}
              maxLength={4}
              inputMode="numeric"
              autoComplete="postal-code"
            />
            <ErrorText message={errors.zip?.message} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-sm font-bold">Ort</Label>
            <input
              {...register("city", { required: "Ort ist erforderlich" })}
              className={fieldCls("city")}
              autoComplete="address-level2"
            />
            <ErrorText message={errors.city?.message} />
          </div>
        </div>

        <SectionDivider />
        <SectionEyebrow icon={<Mail className="h-3 w-3" />}>
          Kontakt
        </SectionEyebrow>

        <div className="flex flex-col gap-1">
          <Label className="text-sm font-bold">E-Mail</Label>
          <input
            value={user?.email ?? ""}
            disabled
            className={INPUT_DISABLED}
          />
          <p className="text-xs text-muted-foreground">
            E-Mail kann nicht geändert werden.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-sm font-bold">
            Telefon{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <input
            {...register("phone")}
            type="tel"
            className={INPUT}
            autoComplete="tel"
          />
        </div>

        <div className="flex items-center gap-3 mt-2 pt-5 border-t border-border">
          <button
            type="submit"
            disabled={saving || !isDirty}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-bold text-white bg-cog-teal rounded-md hover:bg-cog-teal-dark transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Speichern
          </button>
          {justSaved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-cog-teal-dark" />
              Gespeichert.
            </span>
          )}
          {isDirty && !justSaved && (
            <span className="text-sm text-muted-foreground">
              Ungespeicherte Änderungen.
            </span>
          )}
        </div>
      </form>

      <PermissionsCard
        granted={userDoc?.permissions ?? []}
      />
    </div>
  )
}

function PermissionsCard({ granted }: { granted: string[] }) {
  const db = useDb()
  const { data: permDocs } = useCollection(permissionsCollection(db))
  const grantedSet = new Set(granted)
  const total = permDocs.length

  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
        <h2 className="font-heading font-bold text-lg">Berechtigungen</h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {grantedSet.size} von {total}
        </span>
      </div>
      {permDocs.length === 0 ? (
        <div className="px-6 py-8 text-sm text-muted-foreground text-center">
          Keine Berechtigungen definiert.
        </div>
      ) : (
        <ul className="flex flex-col">
          {permDocs.map((perm) => {
            const isGranted = grantedSet.has(perm.id)
            return (
              <li
                key={perm.id}
                className={cn(
                  "grid grid-cols-[40px_minmax(0,1fr)_auto] gap-4 items-center px-6 py-4 border-b border-border last:border-b-0",
                  !isGranted && "opacity-90",
                )}
              >
                <span
                  className={cn(
                    "h-9 w-9 rounded-lg inline-flex items-center justify-center text-white",
                    isGranted ? "bg-cog-teal" : "bg-muted text-muted-foreground",
                  )}
                >
                  <KeyRound className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-heading font-bold text-base leading-tight">
                      {perm.name}
                    </span>
                    {isGranted ? (
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-transparent">
                        Freigegeben
                      </Badge>
                    ) : (
                      <Badge variant="outline">Einführung nötig</Badge>
                    )}
                  </div>
                  {perm.description && (
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      {perm.description}
                    </p>
                  )}
                </div>
                <div />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
