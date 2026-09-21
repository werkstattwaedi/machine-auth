// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react"
import {
  ErrorBadge,
  FIELD_INPUT_OK,
  FIELD_INPUT_ERR,
} from "@/components/checkout/field-error"
import { quantityError } from "./quantity-rules"

/** Digits only — no decimal separator, sign or exponent can be typed. */
const DIGITS_PATTERN = /^\d*$/

/**
 * Integer count input (Stk., Layer). A `type="text"` input with a digits-only
 * keystroke pattern instead of `type="number" step="any"`, so "1.5 Stk." can't
 * be entered in the first place (issue #656) and phones show the numeric
 * keypad.
 *
 * Mirrors `UnitQuantityField`'s contract: the parent owns the numeric `value`,
 * this component owns the text draft and the error state. `onChange(value,
 * hasError)` fires live on every keystroke; `hasError` only turns true after a
 * blur that leaves a field the user has typed in at zero/empty, so an
 * autofocused empty field isn't red on open. Wrap in the caller's `FormField`
 * for the visible label.
 */
export function CountField({
  value,
  onChange,
  ariaLabel,
  autoFocus,
}: {
  value: number
  onChange: (value: number, hasError: boolean) => void
  ariaLabel: string
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState(() => (value > 0 ? String(value) : ""))
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const touched = useRef(false)
  // Last value this field reported upward, so the resync effect can tell an
  // external change from the echo of its own onChange.
  const reported = useRef(value)
  const report = (v: number, hasError: boolean) => {
    reported.current = v
    onChange(v, hasError)
  }

  // Re-sync when the committed value changes externally (the form resets to 0
  // after "Hinzufügen") while the user isn't editing; a reset also forgets
  // that the field was touched so the next blur on the empty field is quiet.
  useEffect(() => {
    if (focused || error || value === reported.current) return
    reported.current = value
    const next = value > 0 ? String(value) : ""
    setDraft((d) => (d === next ? d : next))
    if (value === 0) touched.current = false
  }, [value, focused, error])

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        autoFocus={autoFocus}
        value={draft}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        placeholder="0"
        className={error ? FIELD_INPUT_ERR : FIELD_INPUT_OK}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          const raw = e.target.value
          if (!DIGITS_PATTERN.test(raw)) return
          touched.current = true
          setDraft(raw)
          if (error) setError(null)
          report(raw === "" ? 0 : Number(raw), false)
        }}
        onBlur={() => {
          setFocused(false)
          const n = draft === "" ? 0 : Number(draft)
          const ruleError = touched.current ? quantityError(n, "count") : null
          setError(ruleError)
          report(n, ruleError !== null)
          // Normalise leading zeros ("007" → "7") once the value is accepted.
          if (!ruleError) setDraft(n > 0 ? String(n) : "")
        }}
      />
      {error ? <ErrorBadge message={error} /> : null}
    </>
  )
}
