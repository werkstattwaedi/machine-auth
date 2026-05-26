// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod/v4/mini"

const indexSearchSchema = z.object({
  picc: z.optional(z.string()),
  cmac: z.optional(z.string()),
  kiosk: z.optional(z.string()),
})

/**
 * Root URL is a dispatcher to the wizard's first step. Smart dispatch
 * (no checkout → /checkin; open today → /visit; stale → /checkout with
 * banner) lands in phase 4 of the wizard-routes refactor. For now `/` just
 * forwards into /checkin, preserving any tag-auth / kiosk search params.
 */
export const Route = createFileRoute("/")({
  validateSearch: indexSearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/checkin",
      search,
    })
  },
})
