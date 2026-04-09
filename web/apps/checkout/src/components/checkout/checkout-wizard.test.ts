// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"

/**
 * Tests for the profile-incomplete redirect logic in CheckoutWizard.
 * The actual useEffect lives in checkout-wizard.tsx; here we verify
 * the condition that triggers the redirect.
 */

/** Mirrors the redirect condition from CheckoutWizard */
function shouldRedirectToCompleteProfile(
  isAccountLoggedIn: boolean,
  userDoc: { firstName?: string; termsAcceptedAt?: unknown } | null,
): boolean {
  return !!(isAccountLoggedIn && userDoc && (!userDoc.firstName || !userDoc.termsAcceptedAt))
}

describe("CheckoutWizard profile redirect", () => {
  it("redirects account-logged-in user with missing firstName", () => {
    expect(shouldRedirectToCompleteProfile(true, { firstName: "", termsAcceptedAt: new Date() })).toBe(true)
  })

  it("redirects account-logged-in user with missing termsAcceptedAt", () => {
    expect(shouldRedirectToCompleteProfile(true, { firstName: "Max", termsAcceptedAt: null })).toBe(true)
  })

  it("redirects account-logged-in user with both missing", () => {
    expect(shouldRedirectToCompleteProfile(true, { firstName: "", termsAcceptedAt: null })).toBe(true)
  })

  it("does not redirect when profile is complete", () => {
    expect(shouldRedirectToCompleteProfile(true, { firstName: "Max", termsAcceptedAt: new Date() })).toBe(false)
  })

  it("does not redirect for tag-auth (non-account) users", () => {
    expect(shouldRedirectToCompleteProfile(false, { firstName: "", termsAcceptedAt: null })).toBe(false)
  })

  it("does not redirect when userDoc is null", () => {
    expect(shouldRedirectToCompleteProfile(true, null)).toBe(false)
  })
})
