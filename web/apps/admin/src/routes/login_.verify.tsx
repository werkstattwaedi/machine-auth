// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Filename: the trailing underscore on `login_` is a TanStack Router
// convention that makes this a *sibling* of `/login` rather than a child
// nested inside its Outlet. URL stays `/login/verify`. Without the
// underscore, this component would render inside login.tsx's layout.
// See https://tanstack.com/router/latest/docs/framework/react/routing/routing-concepts

import { createFileRoute } from "@tanstack/react-router"
import { LoginVerifyPage, verifySearchSchema } from "@modules/components/auth"

export const Route = createFileRoute("/login_/verify")({
  validateSearch: verifySearchSchema,
  component: AdminVerifyMagicLinkPage,
})

function AdminVerifyMagicLinkPage() {
  const { token } = Route.useSearch()
  return <LoginVerifyPage token={token} defaultRedirect="/users" />
}
