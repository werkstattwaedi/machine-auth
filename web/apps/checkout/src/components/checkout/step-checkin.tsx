// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback } from "react"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Button } from "@modules/components/ui/button"
import { Avatar } from "@modules/components/ui/avatar"
import { PersonCard } from "./person-card"
import { Plus, ArrowRight, LogIn, UserPlus } from "lucide-react"
import type { CheckoutPerson, PersonsAction } from "./use-checkout-state"
import type { UserType } from "@modules/lib/pricing"
import { validatePerson } from "./validation"

/**
 * Issue #209: a roster member of the signed-in family owner who is not
 * already on the visit. Rendered as a `[+ <FirstName> <LastName>]` quick-add
 * button.
 */
export interface FamilyCandidate {
  userId: string
  firstName: string
  lastName: string
  email: string
  userType: UserType
}

interface StepCheckinProps {
  persons: CheckoutPerson[]
  personsDispatch: React.Dispatch<PersonsAction>
  isAnonymous: boolean
  kiosk: boolean
  isAccountLoggedIn: boolean
  /** Email of the signed-in user — surfaced in the compact identity
   *  strip so the page doesn't redundantly show the editable
   *  PersonCard fields for the user themselves. */
  signedInEmail?: string | null
  /** True when the signed-in user has an active membership; toggles the
   *  "Vereinsmitglied" suffix on the identity strip. */
  isMember?: boolean
  onSignOut: () => void
  /**
   * Called when the user advances past /checkin with a valid form. For the
   * truly-anonymous flow this signs the visitor into Firebase Anonymous
   * Auth so /visit can write items to a Firestore subcollection (issue
   * #151), persists persons to the open checkout doc (#246), and then
   * navigates to /visit. A no-op identity-side for already-identified
   * users (real login or tag-tap), but the route nav still happens.
   */
  onAdvance?: () => Promise<void>
  /**
   * Family roster members of the signed-in user that aren't on the visit
   * yet (issue #209). Empty / omitted for anonymous, tag-tap, single-
   * membership, or non-owner users.
   */
  familyCandidates?: FamilyCandidate[]
}

export function StepCheckin({ persons, personsDispatch, isAnonymous, kiosk, isAccountLoggedIn, signedInEmail, isMember, onSignOut, onAdvance, familyCandidates }: StepCheckinProps) {
  // touched: personId → field → true
  const [touched, setTouched] = useState<Record<string, Record<string, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  // Disables the Weiter button while signing in anonymously so a double-tap
  // can't enqueue two anon sessions.
  const [advancing, setAdvancing] = useState(false)

  const handleBlur = useCallback((personId: string, field: string) => {
    setTouched((prev) => ({
      ...prev,
      [personId]: { ...prev[personId], [field]: true },
    }))
  }, [])

  const allErrors = useMemo(
    () =>
      Object.fromEntries(
        persons.map((p, i) => [p.id, validatePerson(p, isAnonymous, i === 0)]),
      ),
    [persons, isAnonymous],
  )

  const allValid = useMemo(
    () => persons.every((p) => Object.keys(allErrors[p.id] ?? {}).length === 0),
    [persons, allErrors],
  )

  const termsError = useMemo(() => {
    if (!isAnonymous) return null
    const person = persons.find((p) => !p.isPreFilled && allErrors[p.id]?.termsAccepted)
    return person ? allErrors[person.id].termsAccepted : null
  }, [persons, allErrors, isAnonymous])

  const handleWeiter = async () => {
    setSubmitted(true)
    if (!allValid) return
    if (advancing) return
    setAdvancing(true)
    try {
      // Eagerly sign in anonymously here (issue #151) so /visit can write
      // checkout items straight to Firestore — same code path as the
      // authenticated flow. `onAdvance` also handles the nav to /visit.
      if (onAdvance) await onAdvance()
    } finally {
      setAdvancing(false)
    }
  }

  const handleAddPerson = () => {
    setSubmitted(false)
    personsDispatch({ type: "ADD_PERSON" })
  }

  const handleAddFamilyPerson = (candidate: FamilyCandidate) => {
    setSubmitted(false)
    personsDispatch({
      type: "ADD_FAMILY_PERSON",
      person: {
        userId: candidate.userId,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        userType: candidate.userType,
      },
    })
  }

  return (
    <div className="flex flex-col flex-1 gap-6">
      <h2 className="text-xl font-bold font-body">
        Deine Angaben
      </h2>

      <IdentityHint
        kiosk={kiosk}
        isAccountLoggedIn={isAccountLoggedIn}
        isTagIdentified={!isAnonymous && !isAccountLoggedIn}
      />

      {persons.map((person, i) => {
        // Logged-in primary person: render the compact identity strip
        // (avatar + name + email + Abmelden) per the visit-flow mockup.
        // The editable PersonCard isn't useful here — the user can edit
        // their profile under /account/profile if they need to.
        if (i === 0 && isAccountLoggedIn) {
          return (
            <IdentityStrip
              key={person.id}
              person={person}
              email={signedInEmail ?? person.email}
              isMember={!!isMember}
              onSignOut={onSignOut}
            />
          )
        }
        return (
          <PersonCard
            key={person.id}
            person={person}
            index={i}
            isOnly={persons.length === 1}
            showTerms={false}
            dispatch={personsDispatch}
            errors={allErrors[person.id]}
            touched={touched[person.id]}
            submitted={submitted}
            onBlur={(field) => handleBlur(person.id, field)}
          />
        )
      })}

      <div className="flex flex-col items-start gap-3">
        {/*
          Issue #209: family-roster quick-adds render inline with the
          primary "Person hinzufügen" CTA. `flex-wrap` lets the chips
          flow onto a second line on narrow viewports.
        */}
        <div className="flex flex-wrap items-start gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
            onClick={handleAddPerson}
          >
            <Plus className="h-4 w-4" />
            Person hinzufügen
          </button>

          {familyCandidates &&
            familyCandidates.map((candidate) => (
              <button
                key={candidate.userId}
                type="button"
                // Issue #246: chips animate in when they appear (e.g. when
                // the signed-in user is re-added to the picker after
                // removing themselves from the visit).
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors animate-in fade-in slide-in-from-top-2 duration-200"
                onClick={() => handleAddFamilyPerson(candidate)}
              >
                <Plus className="h-4 w-4" />
                {candidate.firstName} {candidate.lastName}
              </button>
            ))}
        </div>

        {isAnonymous && (
          <div className="space-y-3 pt-2">
            <div
              className={
                submitted && termsError
                  ? "bg-[#fce4e4] p-3 rounded-sm space-y-2"
                  : "space-y-2"
              }
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms-accept"
                  className="bg-white"
                  checked={persons.every((p) => p.termsAccepted || p.isPreFilled)}
                  onCheckedChange={(checked) => {
                    persons.forEach((p) => {
                      if (!p.isPreFilled) {
                        personsDispatch({
                          type: "UPDATE_PERSON",
                          id: p.id,
                          updates: { termsAccepted: checked === true },
                        })
                      }
                    })
                  }}
                />
                <label htmlFor="terms-accept" className="text-sm leading-snug">
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
              {submitted && termsError && (
                <span className="block w-full px-2 py-0.5 text-xs text-white bg-[#cc2a24] rounded-sm">
                  {termsError}
                </span>
              )}
            </div>
          </div>
        )}

      </div>

      <div className="flex-1" />

      {/* Sticky bottom navigation */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-t border-border flex gap-3 justify-end">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={handleWeiter}
          disabled={advancing}
        >
          Weiter
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/**
 * Compact identity strip for the signed-in user on /checkin — avatar +
 * name + (email · Vereinsmitglied) + Abmelden link. Replaces the full
 * editable PersonCard since the user can manage their own profile
 * under /account/profile. Matches the visit-flow mockup.
 */
function IdentityStrip({
  person,
  email,
  isMember,
  onSignOut,
}: {
  person: CheckoutPerson
  email: string | null
  isMember: boolean
  onSignOut: () => void
}) {
  const name = `${person.firstName} ${person.lastName}`.trim() || "—"
  const subtitleParts = [email, isMember ? "Vereinsmitglied" : null].filter(
    Boolean,
  ) as string[]
  return (
    <div
      data-testid="identity-strip"
      className="flex items-center gap-4 rounded-md bg-muted/50 px-4 py-3 sm:px-5 sm:py-4 animate-in fade-in duration-200"
    >
      <Avatar name={name} seed={person.userId ?? person.id} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="font-bold text-foreground truncate">{name}</div>
        {subtitleParts.length > 0 && (
          <div className="text-sm text-muted-foreground truncate">
            {subtitleParts.join(" · ")}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="text-sm text-muted-foreground underline hover:text-foreground transition-colors"
      >
        Abmelden
      </button>
    </div>
  )
}

function IdentityHint({
  kiosk,
  isAccountLoggedIn,
  isTagIdentified,
}: {
  kiosk: boolean
  isAccountLoggedIn: boolean
  isTagIdentified: boolean
}) {
  // Already identified — no hint needed
  if (isTagIdentified || isAccountLoggedIn) return null

  // Kiosk — NFC hint
  if (kiosk) {
    return (
      <div className="flex items-center gap-3 rounded-[3px] border border-cog-teal/30 bg-cog-teal/5 px-4 py-2.5">
        <svg
          viewBox="0 0 64 64"
          className="h-8 w-8 shrink-0 text-cog-teal animate-pulse"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="10" y="14" width="44" height="36" rx="4" />
          <path d="M30 38a4 4 0 0 1 0-8" />
          <path d="M26 42a10 10 0 0 1 0-20" />
          <path d="M22 46a16 16 0 0 1 0-28" />
        </svg>
        <span className="text-sm text-muted-foreground">
          Badge an den Leser halten, um deine Daten zu laden
        </span>
      </div>
    )
  }

  // Browser — login / signup hint
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 rounded-[3px] border border-border bg-muted/50 px-4 py-2.5">
      <span className="text-sm text-muted-foreground">
        Bereits registriert oder Konto erstellen?
      </span>
      {/* Plain <a> instead of router <Link> — intentional full reload clears checkout state */}
      <div className="flex items-center gap-1">
        <a href="/login?redirect=/">
          <Button variant="ghost" size="sm" className="text-cog-teal hover:text-cog-teal-dark">
            <LogIn className="h-4 w-4 mr-1.5" />
            Anmelden
          </Button>
        </a>
        <span className="text-muted-foreground/40">|</span>
        <a href="/login?mode=signup&redirect=/">
          <Button variant="ghost" size="sm" className="text-cog-teal hover:text-cog-teal-dark">
            <UserPlus className="h-4 w-4 mr-1.5" />
            Registrieren
          </Button>
        </a>
      </div>
    </div>
  )
}
