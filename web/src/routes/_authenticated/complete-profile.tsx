// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, CheckCircle } from "lucide-react"
import { serverTimestamp } from "firebase/firestore"
import { useForm, Controller } from "react-hook-form"

export const Route = createFileRoute("/_authenticated/complete-profile")({
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

function CompleteProfilePage() {
  const { userDoc } = useAuth()
  const { update, loading: saving } = useFirestoreMutation()
  const navigate = useNavigate()

  const { register, handleSubmit, watch, control, formState: { errors } } = useForm<CompleteProfileFormValues>({
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

  if (userDoc?.termsAcceptedAt) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Profil vervollständigen</h1>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span>Dein Profil ist bereits vollständig.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

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
    navigate({ to: "/" })
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Profil vervollständigen</h1>

      <Card>
        <CardHeader>
          <CardTitle>Bitte vervollständige dein Profil</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Vorname *</Label>
                <Input
                  id="firstName"
                  {...register("firstName", { required: "Vorname ist erforderlich" })}
                />
                {errors.firstName && (
                  <p className="text-xs text-destructive">{errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Nachname *</Label>
                <Input
                  id="lastName"
                  {...register("lastName", { required: "Nachname ist erforderlich" })}
                />
                {errors.lastName && (
                  <p className="text-xs text-destructive">{errors.lastName.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="userType">Benutzertyp *</Label>
              <select
                id="userType"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                {...register("userType")}
              >
                <option value="erwachsen">Erwachsen</option>
                <option value="kind">Kind (u. 18)</option>
                <option value="firma">Firma</option>
              </select>
            </div>

            {isFirma && (
              <div className="space-y-4 rounded border p-4">
                <h4 className="text-sm font-semibold">Rechnungsadresse</h4>
                <div className="space-y-2">
                  <Label htmlFor="company">Firma *</Label>
                  <Input
                    id="company"
                    {...register("company", {
                      validate: (v) => !isFirma || v.trim() !== "" || "Firmenname ist erforderlich",
                    })}
                  />
                  {errors.company && (
                    <p className="text-xs text-destructive">{errors.company.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="street">Strasse *</Label>
                  <Input
                    id="street"
                    {...register("street", {
                      validate: (v) => !isFirma || v.trim() !== "" || "Strasse ist erforderlich",
                    })}
                  />
                  {errors.street && (
                    <p className="text-xs text-destructive">{errors.street.message}</p>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="zip">PLZ *</Label>
                    <Input
                      id="zip"
                      {...register("zip", {
                        validate: (v) => !isFirma || v.trim() !== "" || "PLZ ist erforderlich",
                      })}
                    />
                    {errors.zip && (
                      <p className="text-xs text-destructive">{errors.zip.message}</p>
                    )}
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="city">Ort *</Label>
                    <Input
                      id="city"
                      {...register("city", {
                        validate: (v) => !isFirma || v.trim() !== "" || "Ort ist erforderlich",
                      })}
                    />
                    {errors.city && (
                      <p className="text-xs text-destructive">{errors.city.message}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="prose prose-sm max-h-64 overflow-y-auto rounded border p-4 text-sm">
              <h4>Nutzungsbestimmungen der Offenen Werkstatt Wädenswil</h4>
              <p>
                Mit der Nutzung der Werkstatt akzeptierst du folgende Bedingungen:
              </p>
              <ul>
                <li>Die Werkstatt wird auf eigene Verantwortung genutzt.</li>
                <li>Maschinen dürfen nur nach erfolgter Einführung bedient werden.</li>
                <li>Der Arbeitsplatz ist nach Gebrauch sauber zu hinterlassen.</li>
                <li>Material wird nach Verbrauch fair abgerechnet.</li>
                <li>Die Sicherheitsregeln sind jederzeit einzuhalten.</li>
                <li>Der Verein haftet nicht für Unfälle oder Schäden an persönlichen Gegenständen.</li>
              </ul>
              <p>
                Die vollständigen Nutzungsbestimmungen findest du unter{" "}
                <a
                  href="https://werkstattwaedi.ch/nutzungsbestimmungen"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  werkstattwaedi.ch/nutzungsbestimmungen
                </a>.
              </p>
            </div>

            <Controller
              name="termsAccepted"
              control={control}
              rules={{ validate: (v) => v || "Du musst die Nutzungsbestimmungen akzeptieren" }}
              render={({ field }) => (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="termsAccepted"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <Label htmlFor="termsAccepted" className="text-sm leading-tight">
                    Ich akzeptiere die Nutzungsbestimmungen *
                  </Label>
                </div>
              )}
            />
            {errors.termsAccepted && (
              <p className="text-xs text-destructive">{errors.termsAccepted.message}</p>
            )}

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Profil speichern
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
