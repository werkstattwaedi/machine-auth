// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { z } from "zod/v4/mini"

export { LoginPage, type LoginPageProps } from "./login-page"
export { LoginVerifyPage, type LoginVerifyPageProps } from "./login-verify-page"
export { LinkAccountPage, type LinkAccountPageProps } from "./link-account-page"

/** Search schema for /login when sign-up flow is enabled. */
export const loginSearchSchema = z.object({
  redirect: z.optional(z.string()),
  mode: z.optional(z.string()),
})

/** Search schema for /login/verify (magic-link redemption). */
export const verifySearchSchema = z.object({
  token: z.optional(z.string()),
})
