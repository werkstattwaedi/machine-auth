// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, redirect } from "@tanstack/react-router"

// Step 4 lives on /checkout since issue #750 (the chosen card opens in
// place). Old links and bookmarks land there.
export const Route = createFileRoute("/_wizard/payment")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/checkout", search })
  },
})
