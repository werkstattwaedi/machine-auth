// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback, useEffect } from "react"
import { Checkbox } from "@modules/components/ui/checkbox"
import {
  PersonCard,
  PersonUsageColumns,
  RemovePersonButton,
  type PersonUsageProps,
} from "./person-card"
import { NfcBadgeAffordance } from "./nfc-badge-affordance"
import { CheckinSignin } from "./checkin-signin"
import { AddPersonMenu } from "./add-person-menu"
import { ArrowRight, Check, Info, User, Users } from "lucide-react"
import type {
  CheckoutPerson,
  PersonsAction,
  SavedPersonEntry,
} from "./use-checkout-state"
import {
  USAGE_TYPE_LABELS,
  USER_TYPE_LABELS,
  isOwnerOnlyUsage,
  standardFee,
} from "@modules/lib/pricing"
import { personEntryFee } from "@oww/shared"
import type { PricingConfig } from "@modules/lib/workshop-config"
import { validatePerson } from "./validation"
import { cn } from "@modules/lib/utils"
import { useAutoStartCountdown } from "./use-auto-start-countdown"
import type { PricedPerson } from "./same-day-waiver"

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
   * Issue #465: true when the principal's open checkout is a started visit
   * (`isStartedVisit`: any open checkout except a purchase-only
   * `materialbezug` one). The kiosk footer then drops "Besuch starten" — the
   * visit is already started — and promotes "Material erfassen" to the
   * filled primary, since adding material is the natural next action. No
   * effect outside the kiosk (`onStartVisit` undefined) where the single
   * "Weiter" already advances to /visit.
   */
  visitStarted?: boolean
  /**
   * Issue #732: kiosk badge tap — "Besuch starten" fills over this many ms
   * and then fires on its own (same validation path as a click). Any touch,
   * or a dialog opening, ends the countdown for good (`onCountdownCancel`).
   * Undefined = no countdown; turning it undefined stops a running one.
   */
  autoStartMs?: number
  /** Called once when the countdown ends without firing (touch / dialog). */
  onCountdownCancel?: () => void
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
   * only). This is the checkout owner, whose line can't be removed.
   */
  ownerUserId?: string | null
  /** Pricing config for the live per-person usage fee; null = not loaded. */
  config?: PricingConfig | null
  /**
   * The roster with the same-day waiver previewed (`withSameDayWaiver`), the
   * same persons Check Out prices, so both pages show the fee the server
   * will bill (CHK-39). Omitted = nobody waived.
   */
  feePersons?: readonly PricedPerson[]
  /**
   * The identified person's saved persons (issue #605); offered under
   * "Person hinzufügen" unless already on the visit. Empty / omitted for a
   * guest check-in.
   */
  savedPersons?: readonly SavedPersonEntry[]
  /** Stop suggesting a saved person; rejects when the delete failed. */
  onDeleteSavedPerson?: (saved: SavedPersonEntry) => Promise<void>
}

// Footer buttons (design handoff): 42px teal primary / outline-teal
// secondary, 6px radius.
const FOOTER_PRIMARY =
  "inline-flex h-[42px] items-center gap-2 rounded-md bg-cog-teal px-5 text-[15px] font-semibold text-white transition-colors hover:bg-cog-teal-dark disabled:opacity-60 disabled:cursor-not-allowed"
const FOOTER_SECONDARY =
  "inline-flex h-[42px] items-center gap-2 rounded-md border border-cog-teal bg-white px-5 text-[15px] font-semibold text-cog-teal-dark transition-colors hover:bg-cog-teal-light disabled:opacity-60 disabled:cursor-not-allowed"

export function StepCheckin({ persons, personsDispatch, isAnonymous, kiosk, isAccountLoggedIn, signedInUserId, signedInEmail, isMember, onAdvance, onStartVisit, visitStarted, autoStartMs, onCountdownCancel, tagAuthLoading, tagAuthError, picc, ownerUserId, config = null, feePersons = [], savedPersons = [], onDeleteSavedPerson }: StepCheckinProps) {
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

  const allValid = useMemo(
    () =>
      persons.every((p) => Object.keys(allErrors[p.id] ?? {}).length === 0),
    [persons, allErrors],
  )

  const termsError = useMemo(() => {
    if (!isAnonymous) return null
    const person = persons.find((p) => !p.isPreFilled && allErrors[p.id]?.termsAccepted)
    return person ? allErrors[person.id].termsAccepted : null
  }, [persons, allErrors, isAnonymous])

  // The owner (identified principal) always stays on their own visit — a
  // parent who only accompanies a child is still on the roster (ADR-0048).
  // Everyone else is removable down to "at least one person stays".
  const owner = ownerUserId ?? signedInUserId ?? null
  const canRemovePerson = useCallback(
    (person: CheckoutPerson) => {
      if (persons.length <= 1) return false
      if (person.userId && person.userId === owner) return false
      return true
    },
    [persons.length, owner],
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

  // With everyone on Begleitung nobody works in the workshop: there is no
  // visit to start, so "Material erfassen" becomes the default and "Besuch
  // starten" is greyed out (KIO-21).
  const nobodyWorks =
    persons.length > 0 && persons.every((p) => p.usageType === "materialbezug")

  // Issue #732: the kiosk's default action after a badge tap. Fires the
  // same validated "Besuch starten" path as a click.
  const countdown = useAutoStartCountdown({
    durationMs:
      onStartVisit && !visitStarted && !nobodyWorks ? autoStartMs : undefined,
    onFire: () => void handleAction(onStartVisit),
    onCancel: onCountdownCancel,
  })

  const handleAddPerson = () => {
    setSubmitted(false)
    personsDispatch({ type: "ADD_PERSON" })
  }
  const handleAddSaved = (saved: SavedPersonEntry) => {
    setSubmitted(false)
    personsDispatch({ type: "ADD_SAVED_PERSON", saved })
  }

  // Issue #605: every person picks their own Nutzungsart, and the fee
  // beside it follows live.
  const othersPresent = persons.length > 1
  const usageFor = (person: CheckoutPerson): PersonUsageProps => {
    const standard = standardFee(person.userType, config)
    const waivedToday =
      feePersons.find((p) => p.id === person.id)?.entryFeeWaivedToday === true
    return {
      anonymous: isAnonymous,
      othersPresent,
      fee:
        standard === null
          ? null
          : personEntryFee(
              { ...person, entryFeeWaivedToday: waivedToday },
              "regular",
              () => standard,
            ),
      waivedToday,
    }
  }
  const setUsage = (person: CheckoutPerson) => (usageType: CheckoutPerson["usageType"]) =>
    personsDispatch({ type: "UPDATE_PERSON", id: person.id, updates: { usageType } })

  // Freiwilligengruppe / Interne Nutzung on the owner's line: everyone
  // checks in on their own then, so nobody can be added (CHK-32).
  const ownerPerson = owner ? persons.find((p) => p.userId === owner) : undefined
  const addDisabledReason =
    ownerPerson && isOwnerOnlyUsage(ownerPerson.usageType)
      ? `Bei „${USAGE_TYPE_LABELS[ownerPerson.usageType]}“ checkt jede Person selbst ein.`
      : undefined
  const savedOffered = isAnonymous
    ? []
    : savedPersons.filter(
        (s) => !persons.some((p) => p.savedPersonId === s.id),
      )

  // The person list renders in the guest section (anonymous) and in the
  // signed-in view (identified). Kept as one block: identity strips only
  // ever appear for identified sessions, editable guest cards for both.
  const personsBlock = (
    <>
      {persons.map((person, i) => {
        // The signed-in user is identified by userId match, NOT array
        // index — a rehydrated roster need not list them first.
        const isSignedInUser =
          isAccountLoggedIn &&
          !!signedInUserId &&
          person.userId === signedInUserId
        // Pre-filled persons with a known identity (the signed-in user, or
        // a family member rehydrated from an open checkout that predates
        // ADR-0048) render as the compact identity strip — there's nothing
        // to edit. Anonymous / kiosk first-time
        // entries fall through to the full PersonCard form.
        // Issue #605: a saved person has nothing to type either.
        const isSaved = !isAnonymous && !!person.savedPersonId
        if (isSignedInUser || (person.isPreFilled && person.userId) || isSaved) {
          const isOwnerLine = !!person.userId && person.userId === owner
          return (
            <IdentityStrip
              key={person.id}
              person={person}
              index={i}
              email={
                isSaved
                  ? null
                  : isSignedInUser
                    ? (signedInEmail ?? person.email)
                    : person.email
              }
              suffix={
                isSaved
                  ? USER_TYPE_LABELS[person.userType]
                  : isSignedInUser && isMember
                    ? "Vereinsmitglied"
                    : null
              }
              usage={
                <PersonUsageColumns
                  person={person}
                  index={i}
                  isOwner={isOwnerLine}
                  usage={usageFor(person)}
                  onChange={setUsage(person)}
                />
              }
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
            // Only the first person of a guest check-in can be a company
            // (CHK-28).
            allowFirma={i === 0 && isAnonymous}
            usage={usageFor(person)}
            // Issue #605: an identified session can keep a typed-in person
            // for next time.
            canSave={!isAnonymous && !person.userId && !person.savedPersonId}
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
        <AddPersonMenu
          savedPersons={savedOffered}
          onAddNew={handleAddPerson}
          onAddSaved={handleAddSaved}
          onDeleteSaved={async (saved) => {
            await onDeleteSavedPerson?.(saved)
          }}
          disabledReason={addDisabledReason}
          // Opening the menu is a touch: the kiosk countdown stops (#732).
          onOpen={onCountdownCancel}
        />

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
          Issue #465: once the visit is started (visitStarted) "Besuch
          starten" is dropped and "Material erfassen" becomes the filled
          primary. Issue #732: on a kiosk badge tap the primary fills and
          fires on its own — the filling button is the only cue. */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-t border-border flex items-center gap-3">
        {/* The mock's mono URL in this corner was browser-frame dressing,
            not UI — just a spacer keeping the actions right-aligned. */}
        <span className="flex-1" />
        {onStartVisit ? (
          visitStarted ? (
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
                className={nobodyWorks ? FOOTER_PRIMARY : FOOTER_SECONDARY}
                onClick={() => handleAction(onAdvance)}
                disabled={advancing}
              >
                Material erfassen
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={cn(
                  nobodyWorks ? FOOTER_SECONDARY : FOOTER_PRIMARY,
                  "relative overflow-hidden",
                )}
                onClick={() => handleAction(onStartVisit)}
                disabled={advancing || nobodyWorks}
                data-testid="checkin-start-visit"
                data-countdown={countdown.running ? "running" : undefined}
              >
                {countdown.running && (
                  <span
                    aria-hidden
                    data-testid="auto-start-progress"
                    className="absolute inset-y-0 left-0 bg-cog-teal-dark"
                    style={{
                      width: `${countdown.fillPercent}%`,
                      transitionProperty: "width",
                      transitionTimingFunction: "linear",
                      transitionDuration: `${countdown.fillDurationMs}ms`,
                    }}
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-2">
                  <Check className="h-4 w-4" />
                  Besuch starten
                </span>
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
 * Compact identity strip rendered for any pre-filled person with a known
 * identity on /checkin — the signed-in user themselves (who manages their
 * profile under /account/profile), so we show just the name + a short
 * subtitle + the remove affordance.
 *
 * Action slot, right side (shared RemovePersonButton so it lines up with
 * the guest PersonCard's remove): an X when `onRemove` is supplied — the
 * caller withholds it for the owner, see `canRemovePerson`. Signing out
 * lives in the header account menu (issue #710), not on the strip.
 */
function IdentityStrip({
  person,
  index,
  email,
  suffix,
  usage,
  onRemove,
}: {
  person: CheckoutPerson
  index: number
  email: string | null
  suffix: string | null
  /** The Nutzungsart + fee columns (issue #605). */
  usage: React.ReactNode
  onRemove?: () => void
}) {
  const name = `${person.firstName} ${person.lastName}`.trim() || "—"
  const subtitleParts = [email, suffix].filter(Boolean) as string[]
  return (
    <div
      data-testid="identity-strip"
      // Name | Nutzungsart | Nutzungsgebühr (| remove) — the three columns
      // stack on a phone, with the remove button staying top-right.
      className="relative grid grid-cols-1 gap-4 rounded-[10px] bg-[#f6f6f5] px-4 py-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start sm:px-6 sm:py-5 animate-in fade-in duration-200"
    >
      <div className={cn("min-w-0", onRemove && "pr-10 sm:pr-0")}>
        <div className="truncate font-heading text-lg font-bold text-foreground">
          {name}
        </div>
        {subtitleParts.length > 0 && (
          <div className="mt-0.5 text-sm text-muted-foreground sm:truncate">
            {subtitleParts.join(" · ")}
          </div>
        )}
      </div>
      {usage}
      {onRemove ? (
        <div className="absolute right-3 top-3 sm:static">
          <RemovePersonButton index={index} onRemove={onRemove} />
        </div>
      ) : (
        <span className="hidden sm:block sm:w-8" aria-hidden />
      )}
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
