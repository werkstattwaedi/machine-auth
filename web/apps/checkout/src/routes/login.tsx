// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { LoginPage, loginSearchSchema } from "@modules/components/auth"

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  component: CheckoutLoginPage,
})

function CheckoutLoginPage() {
  const { redirect, signup, from } = Route.useSearch()
  return (
    <LoginPage
      defaultRedirect="/"
      signupEnabled
      googleButtonPosition="bottom"
      redirect={redirect}
      signup={signup !== undefined}
      notice={from === "badge" ? <BadgeTapNotice /> : undefined}
    />
  )
}

/**
 * A badge tapped on a phone lands here (#602): only the kiosk can turn a
 * tap into a session (ADR-0022), so say why the person sees a sign-in page.
 */
function BadgeTapNotice() {
  return (
    <>
      Du bist hier, weil dein Handy den OWW-Badge gelesen hat. Benutze den
      Badge am Self-Checkout und an den Maschinen in der Werkstatt. Auf
      deinem Handy loggst du dich mit deiner E-Mail-Adresse ein.
    </>
  )
}
