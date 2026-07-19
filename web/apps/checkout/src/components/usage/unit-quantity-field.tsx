// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import {
  parseWithDefaultUnit,
  formatQuantity,
  type BaseUnit,
} from "@modules/lib/units"
import {
  ErrorBadge,
  FIELD_INPUT_OK,
  FIELD_INPUT_ERR,
} from "@/components/checkout/field-error"

/** A number, optionally followed by a unit token (letters, µ, ²) and a
 *  trailing dot; a leading "." is allowed (".5m"). Empty is allowed so the
 *  field can be cleared. Keystrokes that don't match are rejected. */
const UNIT_TYPING_PATTERN = /^\d*(?:[.,]\d*)?\s*[a-zµ²]*\.?$/i

/**
 * Controlled quantity input that accepts a value with an optional unit and
 * stores it in `baseUnit`. A bare number is read as `defaultUnit` (a length
 * field labelled cm: "50" → 50 cm), while "50cm", ".5m", "500g", "2.5l" etc.
 * convert via their explicit unit. On blur the display normalises to the
 * largest whole unit (`formatQuantity`), e.g. 0.5 m → "50 cm", 1500 g →
 * "1.5 kg".
 *
 * The parent owns the numeric `value` (in `baseUnit`); this component owns the
 * verbatim text draft and the error state. `onChange(value, hasError)` fires
 * live on every keystroke — `hasError` is only ever true after a blur that
 * couldn't be parsed, so the parent can both price live and block "Hinzufügen"
 * on an unparseable field.
 *
 * Renders the input plus (on error) the standard checkout `ErrorBadge`; wrap
 * it in the caller's `FormField` to attach a visible label.
 */
export function UnitQuantityField({
  value,
  onChange,
  baseUnit,
  defaultUnit,
  ariaLabel,
  placeholder,
  autoFocus,
  errorMessage = "Einheit unbekannt",
}: {
  value: number
  onChange: (value: number, hasError: boolean) => void
  baseUnit: BaseUnit
  /** Unit assumed for a bare number, e.g. "cm", "g", "ml", "min". */
  defaultUnit: string
  ariaLabel: string
  placeholder?: string
  autoFocus?: boolean
  errorMessage?: string
}) {
  const [draft, setDraft] = useState(() =>
    value > 0 ? formatQuantity(value, baseUnit) : "",
  )
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState(false)
  // Default hint shows the assumed unit for a bare number ("0 cm", "0 g"), so
  // it's self-evident that typing "50" means 50 cm.
  const hint = placeholder ?? `0 ${defaultUnit}`

  // Re-sync the draft when the committed value changes externally (e.g. the
  // form resets to 0 after "Hinzufügen") while the user isn't editing.
  useEffect(() => {
    if (focused || error) return
    const canonical = value > 0 ? formatQuantity(value, baseUnit) : ""
    setDraft((d) => (d === canonical ? d : canonical))
  }, [value, baseUnit, focused, error])

  return (
    <>
      <input
        type="text"
        inputMode="text"
        autoFocus={autoFocus}
        value={draft}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        placeholder={hint}
        className={error ? FIELD_INPUT_ERR : FIELD_INPUT_OK}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          const raw = e.target.value
          if (!UNIT_TYPING_PATTERN.test(raw)) return
          setDraft(raw)
          if (error) setError(false)
          const parsed = parseWithDefaultUnit(raw, baseUnit, defaultUnit)
          // Keep the previous value while a unit token is mid-typed
          // (parsed === null) so the live total doesn't flicker to 0.
          onChange(parsed ?? value, false)
        }}
        onBlur={() => {
          setFocused(false)
          const parsed = parseWithDefaultUnit(draft, baseUnit, defaultUnit)
          if (parsed === null) {
            // Non-empty but unparseable: keep verbatim text, flag the error,
            // and block the add.
            setError(true)
            onChange(value, true)
            return
          }
          setError(false)
          onChange(parsed, false)
          setDraft(parsed > 0 ? formatQuantity(parsed, baseUnit) : "")
        }}
      />
      {error ? <ErrorBadge message={errorMessage} /> : null}
    </>
  )
}
