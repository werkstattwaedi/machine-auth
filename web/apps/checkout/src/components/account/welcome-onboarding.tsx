// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// First-login "Willkommen" onboarding for imported members (design handoff
// "Welcome-Dialog Erstanmeldung", variant 2b). A blocking, non-dismissible
// dialog rendered as an OVERLAY on top of the live checkout (see _wizard.tsx)
// — and as the /account/complete-profile route for the member-area gate.
// Four steps: Willkommen → Deine Daten (prefilled) → Nutzungsbestimmungen →
// Wo finde ich was.
//
// The member is "imported" when their users doc has a name but no accepted
// terms (scripts/import-members.ts leaves `termsAcceptedAt: null`). Step 2
// persists profile edits; step 3 persists the terms acceptance immediately —
// so member-area pages (e.g. the step-4 "Mitgliedschaft" link opened in a new
// tab) become reachable rather than bouncing back through the gate. Whether
// the dialog is shown is latched on first load (`needed`), so saving terms in
// step 3 doesn't tear the dialog down before step 4.

import { useEffect, useState } from "react"
import { serverTimestamp } from "firebase/firestore"
import {
  ArrowRight,
  BookOpen,
  Banknote,
  KeyRound,
  Loader2,
  Users,
} from "lucide-react"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { useDb } from "@modules/lib/firebase-context"
import { useDocument } from "@modules/lib/firestore"
import { userRef, membershipRef } from "@modules/lib/firestore-helpers"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { parseSwissPhone } from "@modules/lib/phone"
import { isValidSwissPlz } from "@modules/lib/postal"
import { formatDate } from "@modules/lib/format"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Dialog, DialogContent, DialogTitle } from "@modules/components/ui/dialog"
import { cn } from "@modules/lib/utils"

const TERMS_URL = "https://werkstattwaedi.ch/nutzungsbestimmungen"

// Step-4 resource rows are placeholders (no real routes yet) — open in a new
// tab so the member keeps their onboarding dialog. Wire to real URLs later.
const RESOURCE_LINKS = [
  {
    icon: BookOpen,
    title: "So funktioniert der neue Checkout",
    subtitle: "Check-in, Nutzung erfassen, bezahlen.",
    href: "https://werkstattwaedi.ch/anleitung",
  },
  {
    icon: KeyRound,
    title: "Einführungen & Berechtigungen",
    subtitle: "Maschinen freischalten lassen.",
    href: "https://werkstattwaedi.ch/einfuehrungen",
  },
  {
    icon: Banknote,
    title: "Preisliste",
    subtitle: "Eintritte, Maschinen und Material.",
    href: "https://werkstattwaedi.ch/preisliste",
  },
] as const

const STEP_NAMES = [
  "Willkommen",
  "Deine Daten",
  "Nutzungsbestimmungen",
  "Wo finde ich was",
] as const
const NEXT_LABELS = [
  "Los geht's",
  "Weiter",
  "Akzeptieren und weiter",
  "Zum Check-in",
] as const

interface ProfileFields {
  firstName: string
  lastName: string
  company: string
  street: string
  zip: string
  city: string
  phone: string
}

const EMPTY_FIELDS: ProfileFields = {
  firstName: "",
  lastName: "",
  company: "",
  street: "",
  zip: "",
  city: "",
  phone: "",
}

type FieldErrors = Partial<Record<keyof ProfileFields, string>>

const INPUT_BASE =
  "block w-full h-10 rounded-md border bg-white px-3 text-base md:text-sm shadow-xs outline-none transition-colors box-border"
const INPUT_OK =
  `${INPUT_BASE} border-[#ccc] focus:border-cog-teal focus:ring-2 focus:ring-cog-teal/30`
const INPUT_ERR =
  `${INPUT_BASE} border-destructive focus:border-destructive focus:ring-2 focus:ring-destructive/30`
const INPUT_DISABLED =
  "block w-full h-10 rounded-md border border-[#ccc] bg-[#f5f5f4] px-3 text-base md:text-sm text-muted-foreground cursor-not-allowed box-border"
const LABEL = "text-sm font-bold"

/**
 * Self-contained onboarding dialog. `onDone` hands control back to the parent
 * once the member finishes (or once we detect they never needed onboarding) —
 * the overlay parent dismisses in place; the route wrapper navigates away.
 */
export function WelcomeOnboarding({ onDone }: { onDone: () => void }) {
  const db = useDb()
  const { user, userDoc } = useAuth()
  const { update, loading: saving } = useFirestoreMutation()

  const { data: membership } = useDocument(
    userDoc?.activeMembership
      ? membershipRef(db, userDoc.activeMembership)
      : null,
  )
  const isFamilie = membership?.type === "family"
  // A firma member must supply a company + full address to complete their
  // profile (isProfileComplete). The dialog has no user-type switch (imported
  // members are always "erwachsen"), but an admin can flip an unclaimed
  // member to "firma" — handle it so onboarding can still complete.
  const isFirma = userDoc?.userType === "firma"

  const [step, setStep] = useState(1)
  const [fields, setFields] = useState<ProfileFields>(EMPTY_FIELDS)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [tosAccepted, setTosAccepted] = useState(false)
  const [tosError, setTosError] = useState(false)

  // Latch whether onboarding is needed the first time the doc loads. Saving
  // terms in step 3 flips isProfileComplete → without this latch the parent
  // would unmount us before step 4. Set during render (not an effect) so the
  // latch + prefill land in the same commit as the first doc-backed render.
  const [needed, setNeeded] = useState<boolean | null>(null)
  const [seeded, setSeeded] = useState(false)
  if (userDoc && needed === null) {
    setNeeded(!isProfileComplete(userDoc))
  }
  if (userDoc && !seeded) {
    setSeeded(true)
    setFields({
      firstName: userDoc.firstName ?? "",
      lastName: userDoc.lastName ?? "",
      company: userDoc.billingAddress?.company ?? "",
      street: userDoc.billingAddress?.street ?? "",
      zip: userDoc.billingAddress?.zip ?? "",
      city: userDoc.billingAddress?.city ?? "",
      phone: userDoc.phone ?? "",
    })
  }

  // Nothing to do (already-complete member reached this by mistake) → leave.
  useEffect(() => {
    if (needed === false) onDone()
  }, [needed, onDone])

  if (!userDoc || needed !== true) return null

  const patch = (p: Partial<ProfileFields>) => {
    setFields((f) => ({ ...f, ...p }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(p) as (keyof ProfileFields)[]) delete next[k]
      return next
    })
  }

  /** Validate + persist the step-2 profile edits. Returns true on success. */
  const saveProfile = async (): Promise<boolean> => {
    const next: FieldErrors = {}
    if (fields.firstName.trim() === "") next.firstName = "Vorname ist erforderlich"
    if (fields.lastName.trim() === "") next.lastName = "Nachname ist erforderlich"
    // A firma account needs a company name + full address (isProfileComplete).
    if (isFirma) {
      if (fields.company.trim() === "") next.company = "Firmenname ist erforderlich"
      if (fields.street.trim() === "") next.street = "Strasse ist erforderlich"
      if (fields.zip.trim() === "") next.zip = "PLZ ist erforderlich"
      if (fields.city.trim() === "") next.city = "Ort ist erforderlich"
    }
    if (fields.zip.trim() !== "" && !isValidSwissPlz(fields.zip)) {
      next.zip = "PLZ muss vierstellig sein (z.B. 8820)"
    }

    let phoneE164: string | null = null
    if (fields.phone.trim() !== "") {
      const parsed = await parseSwissPhone(fields.phone)
      if (parsed.ok) {
        phoneE164 = parsed.e164
      } else if (parsed.reason !== "empty") {
        next.phone =
          "Bitte gib eine gültige Schweizer Telefonnummer ein (z.B. +41 79 123 45 67)"
      }
    }

    if (Object.keys(next).length > 0) {
      setErrors(next)
      return false
    }

    const address = {
      company: isFirma
        ? fields.company.trim()
        : (userDoc.billingAddress?.company ?? ""),
      street: fields.street.trim(),
      zip: fields.zip.trim(),
      city: fields.city.trim(),
    }
    // Firma always persists its (now-validated) address; others only when
    // non-empty, so a half-filled optional address doesn't linger.
    const hasAddress =
      isFirma ||
      address.company ||
      address.street ||
      address.zip ||
      address.city

    // userType is intentionally NOT written (keep the imported value). The
    // hook owns the error toast and re-throws — short-circuit and stay put.
    try {
      await update(userRef(db, userDoc.id), {
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        phone: phoneE164,
        billingAddress: hasAddress ? address : null,
      })
    } catch {
      return false
    }
    return true
  }

  /** Persist terms acceptance. Returns true on success. */
  const saveTerms = async (): Promise<boolean> => {
    try {
      await update(userRef(db, userDoc.id), {
        termsAcceptedAt: serverTimestamp(),
      })
    } catch {
      return false
    }
    return true
  }

  const goNext = async () => {
    if (saving) return
    if (step === 2) {
      if (await saveProfile()) setStep(3)
      return
    }
    if (step === 3) {
      if (!tosAccepted) {
        setTosError(true)
        return
      }
      // Record acceptance now so member-area pages (e.g. the step-4
      // "Mitgliedschaft" link, opened in a new tab) are immediately reachable.
      if (await saveTerms()) setStep(4)
      return
    }
    if (step === 4) {
      onDone()
      return
    }
    setStep((s) => s + 1)
  }

  const firstName = userDoc.firstName || fields.firstName

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex max-h-[90dvh] w-full max-w-[calc(100%-2rem)] flex-col gap-5 overflow-y-auto rounded-[14px] p-7 sm:max-w-[640px]"
        data-testid="welcome-onboarding-dialog"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          Erstanmeldung — Schritt {step} von 4: {STEP_NAMES[step - 1]}
        </DialogTitle>

        {/* Progress */}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5" aria-hidden>
            {[1, 2, 3, 4].map((n) => (
              <span
                key={n}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-200",
                  n <= step ? "bg-cog-teal" : "bg-[oklch(0.92_0_0)]",
                )}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Schritt {step} von 4 · {STEP_NAMES[step - 1]}
          </p>
        </div>

        {step === 1 && <StepWelcome firstName={firstName} />}
        {step === 2 && (
          <StepData
            fields={fields}
            errors={errors}
            isFirma={isFirma}
            email={user?.email ?? userDoc.email ?? ""}
            membershipLabel={isFamilie ? "Familie" : "Einzel"}
            validUntil={membership ? formatDate(membership.validUntil) : null}
            onChange={patch}
          />
        )}
        {step === 3 && (
          <StepTerms
            accepted={tosAccepted}
            error={tosError}
            onToggle={(checked) => {
              setTosAccepted(checked)
              if (checked) setTosError(false)
            }}
          />
        )}
        {step === 4 && <StepResources isFamilie={isFamilie} />}

        {/* Footer nav */}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => !saving && setStep((s) => s - 1)}
                disabled={saving}
                data-testid="welcome-back"
                className="inline-flex h-10 items-center rounded-md border border-border bg-white px-4 text-sm shadow-xs transition-colors hover:bg-[oklch(0.97_0_0)] disabled:opacity-50"
              >
                Zurück
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={saving}
            data-testid="welcome-next"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-cog-teal px-5 text-sm font-bold text-white transition-colors hover:bg-cog-teal-dark disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-[15px] w-[15px] animate-spin" aria-hidden />
            ) : null}
            {NEXT_LABELS[step - 1]}
            {!saving && <ArrowRight className="h-[15px] w-[15px]" aria-hidden />}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StepWelcome({ firstName }: { firstName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 font-heading text-[26px] font-bold leading-[1.2]">
        Willkommen im neuen Self-Checkout, {firstName}
      </h2>
      <p className="m-0 text-sm leading-relaxed text-muted-foreground">
        Der Self-Checkout wurde erneuert. Deine Daten und deine Mitgliedschaft
        haben wir aus dem bisherigen System übernommen. Drei kurze Schritte,
        dann kann&rsquo;s losgehen:
      </p>
      <div className="flex flex-col gap-2.5">
        {[
          "Deine Daten prüfen",
          "Nutzungsbestimmungen akzeptieren",
          "Wissen, wo du was findest",
        ].map((label, i) => (
          <div key={label} className="flex items-center gap-2.5 text-sm">
            <span className="inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-cog-teal-light font-heading text-xs font-bold text-cog-teal-dark">
              {i + 1}
            </span>
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

function StepData({
  fields,
  errors,
  isFirma,
  email,
  membershipLabel,
  validUntil,
  onChange,
}: {
  fields: ProfileFields
  errors: FieldErrors
  isFirma: boolean
  email: string
  membershipLabel: string
  validUntil: string | null
  onChange: (p: Partial<ProfileFields>) => void
}) {
  const cls = (f: keyof ProfileFields) => (errors[f] ? INPUT_ERR : INPUT_OK)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 font-heading text-[22px] font-bold">Deine Daten</h2>
        <p className="m-0 text-[13px] text-muted-foreground">
          Übernommen aus dem bisherigen System — bitte prüfen.
        </p>
      </div>

      {validUntil && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-[oklch(0.97_0_0)] px-3.5 py-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1a1a1a] px-2.5 py-0.5 text-[11px] font-semibold text-white">
            <Users className="h-3 w-3" aria-hidden />
            {membershipLabel}
          </span>
          <span className="text-[13px] text-muted-foreground">
            Mitgliedschaft aktiv · gültig bis{" "}
            <strong className="tabular-nums text-foreground">{validUntil}</strong>
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Vorname" error={errors.firstName}>
          <input
            className={cls("firstName")}
            autoComplete="given-name"
            value={fields.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            data-testid="welcome-firstname"
          />
        </Field>
        <Field label="Nachname" error={errors.lastName}>
          <input
            className={cls("lastName")}
            autoComplete="family-name"
            value={fields.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            data-testid="welcome-lastname"
          />
        </Field>
      </div>

      {isFirma && (
        <Field label="Firmenname" error={errors.company}>
          <input
            className={cls("company")}
            autoComplete="organization"
            value={fields.company}
            onChange={(e) => onChange({ company: e.target.value })}
            data-testid="welcome-company"
          />
        </Field>
      )}

      <Field label="Strasse und Hausnummer" error={errors.street}>
        <input
          className={cls("street")}
          autoComplete="street-address"
          value={fields.street}
          onChange={(e) => onChange({ street: e.target.value })}
          data-testid="welcome-street"
        />
      </Field>

      <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
        <Field label="PLZ" error={errors.zip}>
          <input
            className={`${cls("zip")} tabular-nums`}
            maxLength={4}
            inputMode="numeric"
            autoComplete="postal-code"
            value={fields.zip}
            onChange={(e) => onChange({ zip: e.target.value })}
            data-testid="welcome-zip"
          />
        </Field>
        <Field label="Ort" error={errors.city}>
          <input
            className={cls("city")}
            autoComplete="address-level2"
            value={fields.city}
            onChange={(e) => onChange({ city: e.target.value })}
            data-testid="welcome-city"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="E-Mail">
          <input value={email} disabled className={INPUT_DISABLED} />
        </Field>
        <Field
          label={
            <>
              Telefon{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </>
          }
          error={errors.phone}
        >
          <input
            className={cls("phone")}
            type="tel"
            autoComplete="tel"
            value={fields.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            data-testid="welcome-phone"
          />
        </Field>
      </div>
    </div>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: React.ReactNode
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className={LABEL}>{label}</label>
      {children}
      {error && (
        <span className="mt-0.5 text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

function StepTerms({
  accepted,
  error,
  onToggle,
}: {
  accepted: boolean
  error: boolean
  onToggle: (checked: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 font-heading text-[22px] font-bold">
          Nutzungsbestimmungen
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">
          Für die Nutzung der Werkstätten und Maschinen brauchen wir dein
          Einverständnis.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-[oklch(0.97_0_0)] p-4 text-[13px] leading-relaxed text-muted-foreground">
        Die Nutzungsbestimmungen regeln Sicherheit, Haftung und den Umgang mit
        Maschinen und Material in der Offenen Werkstatt Wädenswil.
        <div className="mt-2">
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-cog-teal-dark underline hover:no-underline"
          >
            Nutzungsbestimmungen lesen ↗
          </a>
        </div>
      </div>

      <div className={cn(error && "rounded-lg bg-[#fce4e4] px-3.5 py-3")}>
        <label className="inline-flex cursor-pointer select-none items-center gap-2.5 text-[15px]">
          <Checkbox
            checked={accepted}
            onCheckedChange={(c) => onToggle(c === true)}
            className="h-[18px] w-[18px] bg-white"
            data-testid="welcome-terms"
          />
          <span>
            Ich akzeptiere die{" "}
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-bold text-cog-teal-dark underline"
            >
              Nutzungsbestimmungen
            </a>
          </span>
        </label>
        {error && (
          <div
            className="mt-2.5 rounded bg-[#cc2a24] px-3 py-1.5 text-[13px] text-white"
            role="alert"
            data-testid="welcome-terms-error"
          >
            Nutzungsbestimmungen ist erforderlich.
          </div>
        )}
      </div>
    </div>
  )
}

function StepResources({ isFamilie }: { isFamilie: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 font-heading text-[22px] font-bold">
          Wo finde ich was?
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">
          Alles bestätigt. Das Wichtigste für den Start:
        </p>
      </div>

      {isFamilie && (
        <div className="flex items-center gap-3.5 rounded-[10px] bg-cog-teal-light p-4">
          <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-cog-teal text-white">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <span className="flex-1 text-[13px] leading-normal">
            <span className="block font-heading text-[15px] font-bold text-foreground">
              Deine Familien-Mitgliedschaft
            </span>
            <span className="text-foreground">
              Gilt für alle im selben Haushalt. Familienmitglieder fügst du
              unter{" "}
              <a
                href="/account/membership"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-cog-teal-dark underline"
              >
                «Mitgliedschaft»
              </a>{" "}
              hinzu — sie melden sich danach mit dem eigenen Konto an.
            </span>
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {RESOURCE_LINKS.map(({ icon: Icon, title, subtitle, href }) => (
          <a
            key={title}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3.5 rounded-[10px] border border-border p-4 text-foreground transition-colors hover:border-cog-teal hover:bg-cog-teal-light"
          >
            <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-cog-teal text-white">
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block font-heading text-[15px] font-bold">
                {title}
              </span>
              <span className="block text-[13px] text-muted-foreground">
                {subtitle}
              </span>
            </span>
            <ArrowRight className="h-4 w-4 text-cog-teal-dark" aria-hidden />
          </a>
        ))}
      </div>
    </div>
  )
}
