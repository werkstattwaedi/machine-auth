// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { useEffect } from "react"

export const Route = createFileRoute("/_authenticated/_admin")({
  component: AdminLayout,
})

function AdminLayout() {
  const { isAdmin, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !isAdmin) {
      navigate({ to: "/" })
    }
  }, [isAdmin, loading, navigate])

  if (!isAdmin) return null

  return <Outlet />
}
