// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useCallback } from "react"
import { useNavigate } from "@tanstack/react-router"
import type { RouteIntent } from "@/lib/parse-checkout-qr"

/**
 * Dispatch a parsed QR `RouteIntent` to the matching `/visit/add/...`
 * deep link. The actual route components (`add.list.$listId.tsx` &c.)
 * own loading and rendering the picker; the scanner just hands off.
 *
 * Uses `replace: true` so the batch workflow (scan list A → add items
 * → scan list B from inside the picker) doesn't push every visited
 * list onto the history stack. Switching lists is a context
 * replacement, not forward navigation.
 */
export function useScanNavigation() {
  const navigate = useNavigate()
  return useCallback(
    (intent: RouteIntent) => {
      switch (intent.kind) {
        case "list":
          navigate({
            to: "/visit/add/list/$listId",
            params: { listId: intent.listId },
            replace: true,
          })
          return
        case "item":
          navigate({
            to: "/visit/add/item/$code",
            params: { code: intent.code },
            replace: true,
          })
          return
        case "itemVariant":
          navigate({
            to: "/visit/add/item/$code/$variantId",
            params: { code: intent.code, variantId: intent.variantId },
            replace: true,
          })
          return
        case "workshop":
          navigate({
            to: "/visit/add/workshop/$workshopId",
            params: { workshopId: intent.workshopId },
            replace: true,
          })
          return
      }
    },
    [navigate],
  )
}
