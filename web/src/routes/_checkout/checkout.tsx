// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { CheckoutWizard } from "@/components/checkout/checkout-wizard"

const checkoutSearchSchema = z.object({
  picc: z.string().optional(),
  cmac: z.string().optional(),
})

export const Route = createFileRoute("/_checkout/checkout")({
  validateSearch: checkoutSearchSchema,
  component: CheckoutPage,
})

function CheckoutPage() {
  const { picc, cmac } = Route.useSearch()

  return <CheckoutWizard picc={picc} cmac={cmac} />
}
