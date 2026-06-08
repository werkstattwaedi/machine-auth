// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Fallback profile-completion page for already-signed-in accounts that have an
// e-mail but no completed profile (legacy / admin-created / abandoned). The
// happy path now captures name + member type + terms inline on the login page;
// this page covers the stragglers, reusing the same SignupFields form.

import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import {
  SignupFields,
  EMPTY_SIGNUP_VALUE,
  validateSignupFields,
  signupProfileFrom,
  type SignupFieldsValue,
  type SignupFieldsErrors,
} from "@modules/components/auth"
import { type UserType } from "@modules/lib/pricing"
import { Button } from "@modules/components/ui/button"
import { ArrowRight, Loader2 } from "lucide-react"

const completeProfileSearchSchema = z.object({
  redirect: z.optional(z.string()),
})

export const Route = createFileRoute("/_authonly/account/complete-profile")({
  validateSearch: completeProfileSearchSchema,
  component: CompleteProfilePage,
})

function CompleteProfilePage() {
  const { userDoc, completeSignedInSignup } = useAuth()
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()

  const [value, setValue] = useState<SignupFieldsValue>(EMPTY_SIGNUP_VALUE)
  const [errors, setErrors] = useState<SignupFieldsErrors>({})
  const [saving, setSaving] = useState(false)

  const profileComplete = userDoc ? isProfileComplete(userDoc) : false

  // Prefill from whatever the account already has (e.g. admin-set name).
  useEffect(() => {
    if (!userDoc) return
    setValue((v) => ({
      ...v,
      firstName: userDoc.firstName || v.firstName,
      lastName: userDoc.lastName || v.lastName,
      userType: (userDoc.userType as UserType) ?? v.userType,
      address: {
        company: userDoc.billingAddress?.company ?? v.address.company,
        street: userDoc.billingAddress?.street ?? v.address.street,
        zip: userDoc.billingAddress?.zip ?? v.address.zip,
        city: userDoc.billingAddress?.city ?? v.address.city,
      },
    }))
  }, [userDoc])

  useEffect(() => {
    if (profileComplete) {
      // Fall back to the root dispatcher (not /visit): a freshly completed
      // account has no open checkout, so the dispatcher sends them to /checkin.
      navigate({ to: redirectTo || "/" })
    }
  }, [profileComplete, navigate, redirectTo])

  if (profileComplete) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validateSignupFields(value, { requireCode: false })
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSaving(true)
    try {
      await completeSignedInSignup(signupProfileFrom(value))
      navigate({ to: redirectTo || "/" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl leading-tight">
          Profil vervollständigen
        </h1>
        <p className="text-sm text-muted-foreground">
          Wir brauchen noch deinen Namen und deine Zustimmung.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-border bg-card shadow-xs p-6 sm:p-7 flex flex-col gap-5"
      >
        <SignupFields
          value={value}
          errors={errors}
          onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
          showCode={false}
        />
        <div className="pt-2">
          <Button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 bg-cog-teal hover:bg-cog-teal-dark text-white font-bold"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Profil speichern
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
