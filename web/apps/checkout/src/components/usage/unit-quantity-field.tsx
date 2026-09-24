// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react"
import {
  parseWithDefaultUnit,
  formatInUnit,
  type BaseUnit,
} from "@modules/lib/units"
import {
  FIELD_INPUT_OK,
  FIELD_INPUT_ERR,
} from "@/components/checkout/field-error"
import { quantityError } from "./quantity-rules"

/** A number, optionally followed by a unit token (letters, µ, ²) and a
 *  trailing dot; a leading "." is allowed (".5m"). Empty is allowed so the
 *  field can be cleared. Keystrokes that don't match are rejected. */
const UNIT_TYPING_PATTERN = /^\d*(?:[.,]\d*)?\s*[a-zµ²]*\.?$/i

/** A unit token anywhere in the draft ("50cm", ".5m"). While one is present
 *  the entry-unit suffix hides, so the field never reads "50cm cm". */
const HAS_UNIT_TOKEN = /[a-zµ²]/i

/**
 * Controlled quantity input that accepts a value with an optional unit and
 * stores it in `baseUnit`. A bare number is read as `defaultUnit` (a length
 * field labelled cm: "50" → 50 cm), while "50cm", ".5m", "500g", "2.5l" etc.
 * convert via their explicit unit. The entry unit is shown as a suffix inside
 * the field while typing, and on blur the display normalises back to that
 * entry unit (`formatInUnit`): "120,5" → "120.5" cm, ".5m" → "50" cm. The
 * neighbouring read-only column shows the priced unit (m, m²), so the field
 * itself never switches units under the user (issue #656).
 *
 * The parent owns the numeric `value` (in `baseUnit`); this component owns the
 * verbatim text draft and the error state. `onChange(value, error)` fires
 * live on every keystroke — `error` is only ever a message after a blur that
 * couldn't be parsed ("Einheit unbekannt") or that left a field the user has
 * typed in at zero/empty ("Bitte eine Zahl grösser als 0 eingeben"), otherwise
 * null, so the parent can price live, block "Hinzufügen" on an invalid field
 * and show the message. An untouched field stays quiet on blur so an
 * autofocused empty field isn't red on open.
 *
 * Renders only the input (red border + `aria-invalid` on error). The message
 * itself is shown by the parent form in one full-width block under all its
 * fields — a badge under a narrow grid column wrapped over several lines and
 * pushed the neighbouring fields down. `errorId` names that block so the input
 * can reference it via `aria-describedby`. Wrap in the caller's `FormField`
 * for the visible label.
 */
export function UnitQuantityField({
  value,
  onChange,
  baseUnit,
  defaultUnit,
  ariaLabel,
  placeholder = "0",
  autoFocus,
  errorMessage = "Einheit unbekannt",
  errorId,
}: {
  value: number
  onChange: (value: number, error: string | null) => void
  baseUnit: BaseUnit
  /** Unit assumed for a bare number and shown as the in-field suffix, e.g.
   *  "cm", "g", "ml", "min". */
  defaultUnit: string
  ariaLabel: string
  placeholder?: string
  autoFocus?: boolean
  /** Message for a non-empty draft whose unit token isn't recognised. */
  errorMessage?: string
  /** Id of the parent's error block, linked via `aria-describedby` while the
   *  field is in error. */
  errorId?: string
}) {
  const [draft, setDraft] = useState(() =>
    value > 0 ? formatInUnit(value, baseUnit, defaultUnit) : "",
  )
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const touched = useRef(false)
  // Last value this field reported upward, so the resync effect can tell an
  // external change from the echo of its own onChange.
  const reported = useRef(value)
  const report = (v: number, err: string | null) => {
    reported.current = v
    onChange(v, err)
  }

  // Re-sync the draft when the committed value changes externally (e.g. the
  // form resets to 0 after "Hinzufügen") while the user isn't editing; a
  // reset also forgets that the field was touched so the next blur on the
  // empty field is quiet.
  useEffect(() => {
    if (focused || error || value === reported.current) return
    reported.current = value
    const canonical = value > 0 ? formatInUnit(value, baseUnit, defaultUnit) : ""
    setDraft((d) => (d === canonical ? d : canonical))
    if (value === 0) touched.current = false
  }, [value, baseUnit, defaultUnit, focused, error])

  const showSuffix = !HAS_UNIT_TOKEN.test(draft)

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="text"
        autoFocus={autoFocus}
        value={draft}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && errorId ? errorId : undefined}
        placeholder={placeholder}
        className={`${error ? FIELD_INPUT_ERR : FIELD_INPUT_OK} ${showSuffix ? "pr-10" : ""}`}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          const raw = e.target.value
          if (!UNIT_TYPING_PATTERN.test(raw)) return
          touched.current = true
          setDraft(raw)
          if (error) setError(null)
          const parsed = parseWithDefaultUnit(raw, baseUnit, defaultUnit)
          // Keep the previous value while a unit token is mid-typed
          // (parsed === null) so the live total doesn't flicker to 0.
          report(parsed ?? value, null)
        }}
        onBlur={() => {
          setFocused(false)
          const parsed = parseWithDefaultUnit(draft, baseUnit, defaultUnit)
          if (parsed === null) {
            // Non-empty but unparseable: keep verbatim text, flag the error,
            // and block the add.
            setError(errorMessage)
            report(value, errorMessage)
            return
          }
          const ruleError = touched.current
            ? quantityError(parsed, "measure")
            : null
          if (ruleError) {
            setError(ruleError)
            report(parsed, ruleError)
            return
          }
          setError(null)
          report(parsed, null)
          setDraft(parsed > 0 ? formatInUnit(parsed, baseUnit, defaultUnit) : "")
        }}
      />
      {showSuffix ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
        >
          {defaultUnit}
        </span>
      ) : null}
    </div>
  )
}
