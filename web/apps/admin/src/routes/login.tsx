// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { LoginPage } from "@modules/components/auth"

export const Route = createFileRoute("/login")({
  component: AdminLoginPage,
})

function AdminLoginPage() {
  return (
    <LoginPage
      defaultRedirect="/users"
      subtitle="Administration"
      googleButtonPosition="top"
    />
  )
}
