// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { LookupProvider } from "@/lib/lookup"
import { useEffect } from "react"

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
})

function AdminLayout() {
  const { isAdmin, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !isAdmin) {
      navigate({ to: "/visit" })
    }
  }, [isAdmin, loading, navigate])

  if (!isAdmin) return null

  return (
    <LookupProvider>
      <Outlet />
    </LookupProvider>
  )
}
