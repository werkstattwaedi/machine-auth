// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { LoginPage, loginSearchSchema } from "@modules/components/auth"

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  component: CheckoutLoginPage,
})

function CheckoutLoginPage() {
  const { redirect, signup } = Route.useSearch()
  return (
    <LoginPage
      defaultRedirect="/"
      signupEnabled
      googleButtonPosition="bottom"
      redirect={redirect}
      signup={signup !== undefined}
    />
  )
}
