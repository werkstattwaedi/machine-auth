// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useRef, useEffect } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod"
import { CheckoutWizard } from "@/components/checkout/checkout-wizard"
import { ConfirmDialog } from "@/components/confirm-dialog"

const checkoutSearchSchema = z.object({
  picc: z.string().optional(),
  cmac: z.string().optional(),
  kiosk: z.string().optional(),
})

export const Route = createFileRoute("/_checkout/checkout")({
  validateSearch: checkoutSearchSchema,
  component: CheckoutPage,
})

function CheckoutPage() {
  const { picc, cmac, kiosk } = Route.useSearch()
  const isKiosk = kiosk !== undefined
  const navigate = useNavigate()

  // Track the "accepted" params that the wizard is actually using
  const [activeParams, setActiveParams] = useState<{
    picc?: string
    cmac?: string
  }>({ picc, cmac })

  // Pending params waiting for confirmation
  const [pendingParams, setPendingParams] = useState<{
    picc: string
    cmac: string
  } | null>(null)

  // Track whether checkout is in progress (step > 0 or pre-filled)
  const checkoutActiveRef = useRef(false)

  // Detect URL param changes after initial load
  const prevPiccRef = useRef(picc)
  const prevCmacRef = useRef(cmac)

  useEffect(() => {
    const paramsChanged =
      picc !== prevPiccRef.current || cmac !== prevCmacRef.current
    prevPiccRef.current = picc
    prevCmacRef.current = cmac

    if (!paramsChanged || !picc || !cmac) return

    if (checkoutActiveRef.current) {
      // Checkout in progress — ask for confirmation
      setPendingParams({ picc, cmac })
    } else {
      // No active checkout — accept directly
      setActiveParams({ picc, cmac })
    }
  }, [picc, cmac])

  const handleConfirmNewTag = () => {
    if (pendingParams) {
      setActiveParams(pendingParams)
      setPendingParams(null)
    }
  }

  const handleCancelNewTag = () => {
    setPendingParams(null)
    // Revert URL to previous params
    navigate({
      to: "/checkout",
      search: activeParams.picc
        ? { picc: activeParams.picc, cmac: activeParams.cmac }
        : {},
      replace: true,
    })
  }

  return (
    <>
      <CheckoutWizard
        key={`${activeParams.picc ?? ""}-${activeParams.cmac ?? ""}`}
        picc={activeParams.picc}
        cmac={activeParams.cmac}
        kiosk={isKiosk}
        onActiveChange={(active) => {
          checkoutActiveRef.current = active
        }}
      />
      <ConfirmDialog
        open={!!pendingParams}
        onOpenChange={(open) => {
          if (!open) handleCancelNewTag()
        }}
        title="Neuer Badge erkannt"
        description="Ein Checkout ist bereits in Bearbeitung. Neuen Checkout starten?"
        confirmLabel="Neuer Checkout"
        onConfirm={handleConfirmNewTag}
        destructive
      />
    </>
  )
}
