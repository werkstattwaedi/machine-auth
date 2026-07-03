// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { z } from "zod/v4/mini"

export { LoginPage, type LoginPageProps } from "./login-page"
export { LoginVerifyPage, type LoginVerifyPageProps } from "./login-verify-page"
export { LinkAccountPage, type LinkAccountPageProps } from "./link-account-page"
export {
  GoogleSignInButton,
  type GoogleSignInButtonProps,
} from "./google-signin-button"
export {
  isResendThrottleError,
  requestCodeWithThrottle,
} from "./login-code-request"

export {
  SignupFields,
  EMPTY_SIGNUP_VALUE,
  validateSignupFields,
  signupProfileFrom,
} from "./signup-fields"
export type { SignupFieldsValue, SignupFieldsErrors } from "./signup-fields"

/** Search schema for /login when sign-up flow is enabled. */
export const loginSearchSchema = z.object({
  redirect: z.optional(z.string()),
  // Open directly in the sign-up stage — set by the magic-link verify page
  // when a redeemed link belongs to a not-yet-completed account.
  signup: z.optional(z.string()),
})

/** Search schema for /login/verify (magic-link redemption). */
export const verifySearchSchema = z.object({
  token: z.optional(z.string()),
})
