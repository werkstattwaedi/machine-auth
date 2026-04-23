// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { Label } from "@modules/components/ui/label"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Loader2, ArrowRight } from "lucide-react"
import { serverTimestamp } from "firebase/firestore"
import { useForm, Controller } from "react-hook-form"
import { USER_TYPE_LABELS, type UserType } from "@modules/lib/pricing"

const completeProfileSearchSchema = z.object({
  redirect: z.optional(z.string()),
})

export const Route = createFileRoute("/_authonly/complete-profile")({
  validateSearch: completeProfileSearchSchema,
  component: CompleteProfilePage,
})

interface CompleteProfileFormValues {
  firstName: string
  lastName: string
  userType: string
  company: string
  street: string
  zip: string
  city: string
  termsAccepted: boolean
}

const BASE_INPUT =
  "flex h-9 w-full rounded-none border bg-background px-3 py-1 text-sm outline-none"
const INPUT_OK = `${BASE_INPUT} border-[#ccc] focus:border-cog-teal`
const INPUT_ERR = `${BASE_INPUT} border-[#cc2a24] focus:border-[#cc2a24]`

function ErrorBadge({ message }: { message: string }) {
  return (
    <span className="block w-full mt-1 px-2 py-0.5 text-xs text-white bg-[#cc2a24] rounded-sm">
      {message}
    </span>
  )
}

function CompleteProfilePage() {
  const { userDoc } = useAuth()
  const { update, loading: saving } = useFirestoreMutation()
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()

  const { register, handleSubmit, watch, control, formState: { errors, isSubmitted } } = useForm<CompleteProfileFormValues>({
    defaultValues: {
      firstName: "",
      lastName: "",
      userType: "erwachsen",
      company: "",
      street: "",
      zip: "",
      city: "",
      termsAccepted: false,
    },
  })

  const userType = watch("userType")
  const isFirma = userType === "firma"
  const profileComplete = userDoc ? isProfileComplete(userDoc) : false

  useEffect(() => {
    if (profileComplete) {
      navigate({ to: redirectTo || "/visit" })
    }
  }, [profileComplete, navigate, redirectTo])

  if (profileComplete) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const fieldCls = (field: keyof CompleteProfileFormValues) =>
    isSubmitted && errors[field] ? INPUT_ERR : INPUT_OK
  const wrapCls = (field: keyof CompleteProfileFormValues) =>
    `space-y-1${isSubmitted && errors[field] ? " bg-[#fce4e4] p-2 -m-2 rounded-sm" : ""}`

  const onSubmit = async (values: CompleteProfileFormValues) => {
    if (!userDoc) return

    const data: Record<string, unknown> = {
      firstName: values.firstName,
      lastName: values.lastName,
      userType: values.userType,
      termsAcceptedAt: serverTimestamp(),
    }

    if (values.userType === "firma") {
      data.billingAddress = {
        company: values.company,
        street: values.street,
        zip: values.zip,
        city: values.city,
      }
    } else {
      data.billingAddress = null
    }

    await update("users", userDoc.id, data, {
      successMessage: "Profil gespeichert",
    })
    navigate({ to: redirectTo || "/visit" })
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-bold font-body">
        Profil vervollständigen
      </h2>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <div className="bg-[rgba(204,204,204,0.2)] rounded-none p-[25px] space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={wrapCls("firstName")}>
              <Label htmlFor="firstName" className="text-sm font-bold">
                Vorname
              </Label>
              <input
                id="firstName"
                {...register("firstName", { required: "Vorname ist erforderlich" })}
                className={fieldCls("firstName")}
              />
              {isSubmitted && errors.firstName && <ErrorBadge message={errors.firstName.message!} />}
            </div>
            <div className={wrapCls("lastName")}>
              <Label htmlFor="lastName" className="text-sm font-bold">
                Nachname
              </Label>
              <input
                id="lastName"
                {...register("lastName", { required: "Nachname ist erforderlich" })}
                className={fieldCls("lastName")}
              />
              {isSubmitted && errors.lastName && <ErrorBadge message={errors.lastName.message!} />}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-bold">Nutzer:in</Label>
            <div className="flex gap-3 pt-1">
              {(Object.entries(USER_TYPE_LABELS) as [UserType, string][]).map(
                ([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <span
                      className={`inline-flex items-center justify-center h-4 w-4 rounded-full border ${
                        userType === value
                          ? "border-cog-teal bg-cog-teal"
                          : "border-[#ccc] bg-white"
                      }`}
                    >
                      {userType === value && (
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <input
                      type="radio"
                      value={value}
                      {...register("userType")}
                      className="sr-only"
                    />
                    {label}
                  </label>
                )
              )}
            </div>
          </div>

          {isFirma && (
            <div className="space-y-3 border-t pt-4">
              <Label className="text-sm font-bold">Rechnungsadresse</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={wrapCls("company")}>
                  <Label className="text-sm font-bold">
                    Firma
                  </Label>
                  <input
                    {...register("company", {
                      validate: (v) => !isFirma || v.trim() !== "" || "Firmenname ist erforderlich",
                    })}
                    className={fieldCls("company")}
                  />
                  {isSubmitted && errors.company && <ErrorBadge message={errors.company.message!} />}
                </div>
                <div className={wrapCls("street")}>
                  <Label className="text-sm font-bold">
                    Strasse
                  </Label>
                  <input
                    {...register("street", {
                      validate: (v) => !isFirma || v.trim() !== "" || "Strasse ist erforderlich",
                    })}
                    className={fieldCls("street")}
                  />
                  {isSubmitted && errors.street && <ErrorBadge message={errors.street.message!} />}
                </div>
                <div className={wrapCls("zip")}>
                  <Label className="text-sm font-bold">
                    PLZ
                  </Label>
                  <input
                    {...register("zip", {
                      validate: (v) => !isFirma || v.trim() !== "" || "PLZ ist erforderlich",
                    })}
                    className={fieldCls("zip")}
                  />
                  {isSubmitted && errors.zip && <ErrorBadge message={errors.zip.message!} />}
                </div>
                <div className={wrapCls("city")}>
                  <Label className="text-sm font-bold">
                    Ort
                  </Label>
                  <input
                    {...register("city", {
                      validate: (v) => !isFirma || v.trim() !== "" || "Ort ist erforderlich",
                    })}
                    className={fieldCls("city")}
                  />
                  {isSubmitted && errors.city && <ErrorBadge message={errors.city.message!} />}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Controller
            name="termsAccepted"
            control={control}
            rules={{ validate: (v) => v || "Du musst die Nutzungsbestimmungen akzeptieren" }}
            render={({ field }) => (
              <div
                className={
                  isSubmitted && errors.termsAccepted
                    ? "bg-[#fce4e4] p-3 rounded-sm space-y-2"
                    : "space-y-2"
                }
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="termsAccepted"
                    className="bg-white"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <label htmlFor="termsAccepted" className="text-sm leading-snug">
                    Ich akzeptiere die{" "}
                    <a
                      href="https://werkstattwaedi.ch/nutzungsbestimmungen"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="underline font-bold text-cog-teal"
                    >
                      Nutzungsbestimmungen
                    </a>
                  </label>
                </div>
                {isSubmitted && errors.termsAccepted && (
                  <ErrorBadge message={errors.termsAccepted.message!} />
                )}
              </div>
            )}
          />
        </div>

        <div>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Profil speichern
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  )
}
