// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { RotateCcw } from "lucide-react"
import type { AppMenuEntry } from "@modules/components/app-header/app-menu"
import { useBridge } from "@modules/lib/use-bridge"
import { useWizardContext } from "./wizard-context"

/**
 * The menu entry, or null unless the session is anonymous AND there's an
 * open checkout to abandon. Kiosk mode (issue #415): the chrome's "Neuer
 * Checkout" button is the affordance, so there is no in-page entry under the
 * bridge.
 */
export function useStartOverMenuEntry(
  onRequest: () => void,
): AppMenuEntry | null {
  const { isAnonymous, openCheckout } = useWizardContext()
  const { available } = useBridge()
  if (!isAnonymous || !openCheckout || available) return null
  return { label: "Von vorne beginnen", icon: RotateCcw, onSelect: onRequest }
}
