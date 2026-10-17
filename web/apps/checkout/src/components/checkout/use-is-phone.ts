// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"

// Below Tailwind's `sm` breakpoint: a phone held upright. Tablets and the
// kiosk screen are wider.
const PHONE_QUERY = "(max-width: 639px)"

function matchesPhone(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PHONE_QUERY).matches
    : false
}

/**
 * True on a phone-width viewport. Read synchronously on the first render, so
 * a component can pick its initial state from it (the Spende box starts
 * collapsed on a phone) without a flash of the other layout.
 */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(matchesPhone)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const mql = window.matchMedia(PHONE_QUERY)
    const onChange = () => setIsPhone(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  return isPhone
}
