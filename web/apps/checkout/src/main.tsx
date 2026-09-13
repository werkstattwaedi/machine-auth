// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { withEnvLabel } from "@oww/shared"
import { routeTree } from "./routeTree.gen"
import "@modules/index.css"

// VITE_ENV_LABEL (operations config web.envLabel) marks non-production
// builds in the tab title, e.g. "[staging] …". Empty in prod. Set at
// runtime rather than via %VITE_ENV_LABEL% in index.html so an absent var
// never leaks the literal placeholder into the title.
document.title = withEnvLabel(import.meta.env.VITE_ENV_LABEL, document.title)

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
