// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/users" })
  },
})
