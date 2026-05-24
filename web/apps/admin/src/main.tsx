// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"
import "@modules/index.css"

// VITE_CHECKOUT_DOMAIN is generated from the operations config
// (web.checkoutDomain) and used by the label-print flow to build the
// QR-encoded URL. Surface a loud warning at startup when it's missing
// so dev configuration mistakes don't hide as a silently-disabled
// "Etikett drucken" button.
if (!import.meta.env.VITE_CHECKOUT_DOMAIN) {
  console.warn(
    "[admin] VITE_CHECKOUT_DOMAIN is unset — label printing will be " +
      "disabled. Run `npm run generate-env` from the repo root.",
  )
}

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
