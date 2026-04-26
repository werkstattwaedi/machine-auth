// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { LinkAccountPage } from "@modules/components/auth"

export const Route = createFileRoute("/link-account")({
  component: CheckoutLinkAccountPage,
})

function CheckoutLinkAccountPage() {
  return <LinkAccountPage defaultRedirect="/visit" />
}
