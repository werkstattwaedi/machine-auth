// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useCallback } from "react"
import { useNavigate } from "@tanstack/react-router"
import type { RouteIntent } from "@/lib/parse-checkout-qr"

export interface ScanNavigationOptions {
  /** Wizard search params to carry onto the picker route. */
  search?: { kiosk?: string }
  /** Defaults to true (the scanner's batch workflow, see below). */
  replace?: boolean
}

/**
 * Dispatch a parsed QR `RouteIntent` to the matching `/visit/add/...`
 * deep link. The actual route components (`add.list.$listId.tsx` &c.)
 * own loading and rendering the picker; the scanner just hands off.
 *
 * Uses `replace: true` by default so the batch workflow (scan list A → add
 * items → scan list B from inside the picker) doesn't push every visited
 * list onto the history stack. Switching lists is a context
 * replacement, not forward navigation. The check-in step, which resumes a
 * cold scan's target (issue #664), is forward navigation and passes
 * `replace: false`.
 *
 * The target is always built from typed route params, never from a raw
 * href, so an intent parsed from untrusted input (a scanned code, the
 * `next` search param) cannot leave the four `/visit/add/...` routes.
 */
export function useScanNavigation() {
  const navigate = useNavigate()
  return useCallback(
    (intent: RouteIntent, options?: ScanNavigationOptions) => {
      // Only set `search` when the caller asked for it, so the scanner's
      // navigation stays exactly what it was.
      const common = {
        replace: options?.replace ?? true,
        ...(options?.search ? { search: options.search } : {}),
      }
      switch (intent.kind) {
        case "list":
          navigate({
            to: "/visit/add/list/$listId",
            params: { listId: intent.listId },
            ...common,
          })
          return
        case "item":
          navigate({
            to: "/visit/add/item/$code",
            params: { code: intent.code },
            ...common,
          })
          return
        case "itemVariant":
          navigate({
            to: "/visit/add/item/$code/$variantId",
            params: { code: intent.code, variantId: intent.variantId },
            ...common,
          })
          return
        case "workshop":
          navigate({
            to: "/visit/add/workshop/$workshopId",
            params: { workshopId: intent.workshopId },
            ...common,
          })
          return
      }
    },
    [navigate],
  )
}
