// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback, useEffect } from "react"
import { Checkbox } from "@modules/components/ui/checkbox"
import { PersonCard, RemovePersonButton } from "./person-card"
import { NfcBadgeAffordance } from "./nfc-badge-affordance"
import { CheckinSignin } from "./checkin-signin"
import { Plus, ArrowRight, Check, Info, User, Users } from "lucide-react"
import type { CheckoutPerson, PersonsAction } from "./use-checkout-state"
import type { UserType } from "@modules/lib/pricing"
import { validatePerson, rosterAccountError } from "./validation"
import { cn } from "@modules/lib/utils"

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
  /**
   * ADR-0029: the member has their own login account (non-empty email on
   * their user doc). Rendered as a disabled chip — account-holders check
   * in and out on their own account and are never rostered onto someone
   * else's checkout. Always false for the identified principal themselves
   * (the checkout owner is the allowed exception).
   */
  hasAccount: boolean
}

interface StepCheckinProps {
  persons: CheckoutPerson[]
  personsDispatch: React.Dispatch<PersonsAction>
  isAnonymous: boolean
  kiosk: boolean
  isAccountLoggedIn: boolean
  /** userDoc id of the logged-in user. We key the "this card is the
   *  signed-in user" decision off `person.userId === signedInUserId`
   *  instead of array index — the signed-in user can be removed and
   *  re-added in any order. */
  signedInUserId?: string | null
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
   * Kiosk-only primary action: check the visitor in (create the checkout)
   * and hand the terminal back to the next person. When provided, the
   * footer renders "Besuch starten" as the filled primary button and
   * demotes the /visit navigation ("Material erfassen") to an outline
   * secondary — checking in IS the main job of the kiosk; browsing costs
   * is the exception. Runs through the same form validation as onAdvance.
   */
  onStartVisit?: () => Promise<void>
  /**
   * Issue #465: true when an open checkout already exists for this principal
   * (e.g. the visitor tapped their badge with a checkout still running, then
   * navigated back to /checkin). The kiosk footer then drops "Besuch starten"
   * — the visit is already started — and promotes "Material erfassen" to the
   * filled primary, since adding material is the natural next action. No
   * effect outside the kiosk (`onStartVisit` undefined) where the single
   * "Weiter" already advances to /visit.
   */
  hasOpenCheckout?: boolean
  /**
   * Family roster members of the signed-in user that aren't on the visit
   * yet (issue #209). Empty / omitted for anonymous, tag-tap, single-
   * membership, or non-owner users.
   */
  familyCandidates?: FamilyCandidate[]
  /** True while a tapped badge is verified — the kiosk NFC affordance
   *  box shows the progress state instead of a blocking overlay. */
  tagAuthLoading?: boolean
  /** Badge verification failure, folded into the kiosk NFC affordance
   *  box; null/omitted otherwise. */
  tagAuthError?: string | null
  /** Tap nonce the affordance keys error dismissal on. */
  picc?: string
  /**
   * User-doc id of the identified principal — the signed-in account OR the
   * tag-tapped badge user (unlike `signedInUserId`, which is account-login
   * only). ADR-0029's advisory roster check exempts this id: the owner's
   * own line legitimately carries their userId.
   */
  ownerUserId?: string | null
}

// Footer buttons (design handoff): 42px teal primary / outline-teal
// secondary, 6px radius.
const FOOTER_PRIMARY =
  "inline-flex h-[42px] items-center gap-2 rounded-md bg-cog-teal px-5 text-[15px] font-semibold text-white transition-colors hover:bg-cog-teal-dark disabled:opacity-60 disabled:cursor-not-allowed"
const FOOTER_SECONDARY =
  "inline-flex h-[42px] items-center gap-2 rounded-md border border-cog-teal bg-white px-5 text-[15px] font-semibold text-cog-teal-dark transition-colors hover:bg-cog-teal-light disabled:opacity-60 disabled:cursor-not-allowed"

export function StepCheckin({ persons, personsDispatch, isAnonymous, kiosk, isAccountLoggedIn, signedInUserId, signedInEmail, isMember, onSignOut, onAdvance, onStartVisit, hasOpenCheckout, familyCandidates, tagAuthLoading, tagAuthError, picc, ownerUserId }: StepCheckinProps) {
  // touched: personId → field → true
  const [touched, setTouched] = useState<Record<string, Record<string, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  // Disables the Weiter button while signing in anonymously so a double-tap
  // can't enqueue two anon sessions.
  const [advancing, setAdvancing] = useState(false)

  // Which side of the "Mit Konto anmelden / Als Gast" switcher is active
  // while the visitor is anonymous. Account is the default (design handoff
  // "Kiosk sign-in flow redesign") — EXCEPT when the guest form already
  // carries data (typed earlier, or rehydrated from an open anon checkout):
  // hiding a half-filled form behind the account tab would look like data
  // loss.
  const [section, setSection] = useState<"account" | "guest">(() =>
    persons.some(
      (p) =>
        p.isPreFilled ||
        p.firstName.trim() ||
        p.lastName.trim() ||
        p.email.trim(),
    )
      ? "guest"
      : "account",
  )

  // A badge tap is accepted at any time (the kiosk reader is always
  // listening), including while the guest form is open — flip to the
  // account section so the verify progress/error inside the NFC affordance
  // box is actually visible.
  useEffect(() => {
    if (tagAuthLoading) setSection("account")
  }, [tagAuthLoading])

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

  // ADR-0029 advisory roster check: an account-holding family member on the
  // roster can't be fixed by editing fields — they must be removed — so the
  // error renders as a standalone notice instead of a per-field message.
  // The identified principal (the owner) is exempt; prefer `ownerUserId`
  // (set for both account-login and tag-tap) and fall back to
  // `signedInUserId` for callers that only supply the account-login id.
  const rosterError = useMemo(
    () => rosterAccountError(persons, ownerUserId ?? signedInUserId ?? null),
    [persons, ownerUserId, signedInUserId],
  )

  const allValid = useMemo(
    () =>
      persons.every((p) => Object.keys(allErrors[p.id] ?? {}).length === 0) &&
      !rosterError,
    [persons, allErrors, rosterError],
  )

  const termsError = useMemo(() => {
    if (!isAnonymous) return null
    const person = persons.find((p) => !p.isPreFilled && allErrors[p.id]?.termsAccepted)
    return person ? allErrors[person.id].termsAccepted : null
  }, [persons, allErrors, isAnonymous])

  // A checkout must stay anchored to at least one account-linked member —
  // walk-in guests (no userId) can't stand alone. So an account-linked
  // person (the signed-in user or a family quick-add member) may only be
  // removed while another member remains. With no family membership the
  // signed-in user is the only member and therefore can't remove themselves.
  // Guests are always removable (down to "at least one person stays").
  const memberCount = useMemo(
    () => persons.filter((p) => !!p.userId).length,
    [persons],
  )
  const canRemovePerson = useCallback(
    (person: CheckoutPerson) => {
      if (persons.length <= 1) return false
      if (person.userId && memberCount <= 1) return false
      return true
    },
    [persons.length, memberCount],
  )

  // Shared validate-then-act path for both footer actions. "Weiter" /
  // "Material erfassen" run `onAdvance` (anon sign-in #151, persist #246,
  // nav to /visit); the kiosk "Besuch starten" runs `onStartVisit`
  // (check-in + terminal reset) behind the exact same form validation.
  const handleAction = async (action?: () => Promise<void>) => {
    setSubmitted(true)
    if (!allValid) return
    if (advancing) return
    setAdvancing(true)
    try {
      if (action) await action()
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

  // The person list renders in the guest section (anonymous) and in the
  // signed-in view (identified). Kept as one block: identity strips only
  // ever appear for identified sessions, editable guest cards for both.
  const personsBlock = (
    <>
      {persons.map((person, i) => {
        // The signed-in user is identified by userId match, NOT array
        // index — a parent can remove themselves and re-add via a
        // quick-add chip, ending up at any position in the array.
        const isSignedInUser =
          isAccountLoggedIn &&
          !!signedInUserId &&
          person.userId === signedInUserId
        // Pre-filled persons with a known identity (signed-in user or a
        // family quick-add member) render as the compact identity strip
        // — there's nothing to edit. Anonymous / kiosk first-time
        // entries fall through to the full PersonCard form.
        if (isSignedInUser || (person.isPreFilled && person.userId)) {
          return (
            <IdentityStrip
              key={person.id}
              person={person}
              index={i}
              email={isSignedInUser ? (signedInEmail ?? person.email) : person.email}
              suffix={isSignedInUser && isMember ? "Vereinsmitglied" : null}
              onSignOut={isSignedInUser ? onSignOut : undefined}
              onRemove={
                canRemovePerson(person)
                  ? () =>
                      personsDispatch({ type: "REMOVE_PERSON", id: person.id })
                  : undefined
              }
            />
          )
        }
        return (
          <PersonCard
            key={person.id}
            person={person}
            index={i}
            showTerms={false}
            // Anonymous walk-ins stay editable even when rehydrated from the
            // open checkout (isPreFilled) — they have no account profile to
            // manage, so /checkin is the only place to correct their data.
            editable={isAnonymous}
            dispatch={personsDispatch}
            errors={allErrors[person.id]}
            touched={touched[person.id]}
            submitted={submitted}
            onBlur={(field) => handleBlur(person.id, field)}
            onRemove={
              canRemovePerson(person)
                ? () =>
                    personsDispatch({ type: "REMOVE_PERSON", id: person.id })
                : undefined
            }
          />
        )
      })}
    </>
  )

  const addPersonBlock = (
    <div className="flex flex-col items-start gap-3">
        {/*
          Issue #209: family-roster quick-adds render inline with the
          primary "Person hinzufügen" CTA. `flex-wrap` lets the chips
          flow onto a second line on narrow viewports.
        */}
        <div className="flex flex-wrap items-start gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-cog-teal bg-white px-4 py-2.5 text-sm font-semibold text-cog-teal-dark transition-colors hover:bg-cog-teal-light"
            onClick={handleAddPerson}
          >
            <Plus className="h-4 w-4" />
            Person hinzufügen
          </button>

          {familyCandidates &&
            familyCandidates.map((candidate) =>
              candidate.hasAccount ? (
                // ADR-0029: account-holding family members check in on their
                // own account. The chip stays visible but disabled so the
                // rule is discoverable instead of the member silently
                // missing from the picker.
                <button
                  key={candidate.userId}
                  type="button"
                  disabled
                  title="Checkt mit dem eigenen Konto ein"
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-border bg-white px-4 py-2.5 text-sm font-semibold text-muted-foreground opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  {candidate.firstName} {candidate.lastName}
                </button>
              ) : (
                <button
                  key={candidate.userId}
                  type="button"
                  // Issue #246: chips animate in when they appear (e.g. when
                  // the signed-in user is re-added to the picker after
                  // removing themselves from the visit).
                  className="inline-flex items-center gap-2 rounded-md border border-cog-teal bg-white px-4 py-2.5 text-sm font-semibold text-cog-teal-dark transition-colors hover:bg-cog-teal-light animate-in fade-in slide-in-from-top-2 duration-200"
                  onClick={() => handleAddFamilyPerson(candidate)}
                >
                  <Plus className="h-4 w-4" />
                  {candidate.firstName} {candidate.lastName}
                </button>
              ),
            )}
        </div>

        {familyCandidates?.some((c) => c.hasAccount) && (
          <p className="text-xs text-muted-foreground">
            Familienmitglieder mit eigenem Konto checken separat ein.
          </p>
        )}

        {rosterError && (
          <p className="text-sm text-[#cc2a24]">{rosterError}</p>
        )}

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
                {/* Terms gate on `isPreFilled` even though anon walk-ins now
                    render editable: a rehydrated person is always
                    `termsAccepted: true` (personDocToLocal), and editing
                    fields never flips that — so "pre-filled ⇒ already
                    accepted" holds. A fresh guest (isPreFilled false) still
                    must tick the box. */}
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
  )

  return (
    <div className="flex flex-col flex-1 gap-6">
      {isAnonymous ? (
        <>
          {/* Explicit first-class choice between the two paths (design
              handoff): a segmented switcher instead of the old "sign in
              with your account" sub-link. During code entry the dialog's
              scrim covers it; once signed in this whole branch unmounts. */}
          <div
            role="tablist"
            aria-label="Anmeldeart"
            className="flex gap-1 rounded-[10px] bg-[#eee] p-1"
          >
            <SegmentButton
              active={section === "account"}
              onClick={() => setSection("account")}
              testId="checkin-seg-account"
            >
              <User className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
              <span className="hidden sm:inline">Mit Konto anmelden</span>
              <span className="sm:hidden">Mit Konto</span>
            </SegmentButton>
            <SegmentButton
              active={section === "guest"}
              onClick={() => setSection("guest")}
              testId="checkin-seg-guest"
            >
              <Users className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
              Als Gast
            </SegmentButton>
          </div>

          {section === "account" ? (
            <CheckinSignin kiosk={kiosk}>
              {/* Kiosk only: the always-listening badge reader, below the
                  "oder" divider. The affordance owns the tap lifecycle
                  (invite → verifying → error) and this whole branch
                  unmounts once the tag identifies the visitor. */}
              {kiosk ? (
                <NfcBadgeAffordance
                  collapsed={false}
                  verifying={tagAuthLoading ?? false}
                  error={tagAuthError ?? null}
                  picc={picc}
                />
              ) : undefined}
            </CheckinSignin>
          ) : (
            <>
              {/* Refined handoff §6: the member-discount nudge lives on the
                  guest side (gold info strip); "anmelden" flips back to the
                  account tab. Plain account holders get convenience, not a
                  discount — so the account tab carries no benefit pitch. */}
              <div className="flex items-start gap-2.5 rounded-lg border border-oww-gold-border bg-oww-gold-light px-3.5 py-3 text-[13px] leading-relaxed text-oww-gold-text-muted">
                <Info
                  className="mt-0.5 h-[17px] w-[17px] shrink-0 text-oww-gold-dark"
                  aria-hidden
                />
                <span>
                  Als Gast zahlst du den regulären Tarif.{" "}
                  <b className="text-oww-gold-text">Vereinsmitglieder</b>{" "}
                  bekommen ihren Rabatt nur, wenn sie sich mit Konto{" "}
                  <button
                    type="button"
                    onClick={() => setSection("account")}
                    data-testid="checkin-guestnote-signin"
                    className="font-bold text-oww-gold-text underline hover:no-underline"
                  >
                    anmelden
                  </button>
                  .
                </span>
              </div>
              {personsBlock}
              {addPersonBlock}
            </>
          )}
        </>
      ) : (
        <>
          <h2 className="font-heading text-xl font-bold">Deine Angaben</h2>
          {personsBlock}
          {addPersonBlock}
        </>
      )}

      <div className="flex-1" />

      {/* Sticky bottom navigation. With onStartVisit (kiosk) the primary
          action is checking in; the /visit detour is the outline secondary.
          Issue #465: once a checkout is already open (hasOpenCheckout) the
          visit is started, so "Besuch starten" is dropped and "Material
          erfassen" becomes the filled primary. */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-t border-border flex items-center gap-3">
        <span
          className="hidden flex-1 font-mono text-xs text-muted-foreground sm:block"
          aria-hidden
        >
          {window.location.host}/checkin
        </span>
        <span className="flex-1 sm:hidden" />
        {onStartVisit ? (
          hasOpenCheckout ? (
            <button
              type="button"
              className={FOOTER_PRIMARY}
              onClick={() => handleAction(onAdvance)}
              disabled={advancing}
            >
              Material erfassen
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <>
              <button
                type="button"
                className={FOOTER_SECONDARY}
                onClick={() => handleAction(onAdvance)}
                disabled={advancing}
              >
                Material erfassen
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={FOOTER_PRIMARY}
                onClick={() => handleAction(onStartVisit)}
                disabled={advancing}
              >
                <Check className="h-4 w-4" />
                Besuch starten
              </button>
            </>
          )
        ) : (
          <button
            type="button"
            className={FOOTER_PRIMARY}
            onClick={() => handleAction(onAdvance)}
            // On the account side of the switcher there is nothing to
            // advance with yet — the visitor signs in (or switches to the
            // guest form) first. Enabling it would validate the hidden
            // guest form and surface errors for fields that aren't on
            // screen.
            disabled={advancing || (isAnonymous && section === "account")}
          >
            Weiter
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Compact identity strip rendered for any pre-filled person on
 * /checkin — the signed-in user themselves, and family-roster members
 * added via the quick-add chips. There's nothing to edit in either
 * case (the signed-in user manages their profile under
 * /account/profile; family members are pulled from their own user
 * docs), so we show just the name + a short subtitle + the
 * action affordances.
 *
 * Action slot, right side (shared RemovePersonButton so it lines up with
 * the guest PersonCard's remove):
 *   - Abmelden (only for the signed-in user — signs the whole session out)
 *   - X (when `onRemove` is supplied — the caller gates this so the last
 *     account-linked member can't be removed; see `canRemovePerson`)
 *
 * Mike's "if I add my kid, I need to be able to remove myself" rule holds
 * once another family member is on the visit; with no family membership the
 * signed-in user is the only member and the X is withheld.
 */
function IdentityStrip({
  person,
  index,
  email,
  suffix,
  onSignOut,
  onRemove,
}: {
  person: CheckoutPerson
  index: number
  email: string | null
  suffix: string | null
  onSignOut?: () => void
  onRemove?: () => void
}) {
  const name = `${person.firstName} ${person.lastName}`.trim() || "—"
  const subtitleParts = [email, suffix].filter(Boolean) as string[]
  return (
    <div
      data-testid="identity-strip"
      className="flex items-center gap-4 rounded-[10px] bg-[#f6f6f5] px-4 py-4 sm:px-6 sm:py-5 animate-in fade-in duration-200"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-heading text-lg font-bold text-foreground">
          {name}
        </div>
        {subtitleParts.length > 0 && (
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {subtitleParts.join(" · ")}
          </div>
        )}
      </div>
      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="whitespace-nowrap text-sm text-foreground underline hover:no-underline"
        >
          Abmelden
        </button>
      )}
      {onRemove && <RemovePersonButton index={index} onRemove={onRemove} />}
    </div>
  )
}

/**
 * One segment of the account/guest switcher: equal-width, heading typeface,
 * active = white fill on the grey track.
 */
function SegmentButton({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean
  onClick: () => void
  testId: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex h-[42px] flex-1 items-center justify-center gap-2 rounded-[7px] font-heading text-sm font-bold transition-all sm:h-[46px] sm:gap-2.5 sm:text-[15px]",
        active
          ? "bg-white text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.14)]"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
