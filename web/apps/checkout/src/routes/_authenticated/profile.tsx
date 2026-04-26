// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@modules/lib/auth"
import { useCollection } from "@modules/lib/firestore"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useDb } from "@modules/lib/firebase-context"
import {
  permissionsCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import { Label } from "@modules/components/ui/label"
import { Badge } from "@modules/components/ui/badge"
import { useForm } from "react-hook-form"
import { Loader2, Save } from "lucide-react"
import { useEffect } from "react"
import { USER_TYPE_LABELS, type UserType } from "@modules/lib/pricing"

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
})

interface ProfileFormValues {
  displayName: string
  firstName: string
  lastName: string
  userType: string
  company: string
  street: string
  zip: string
  city: string
}

const BASE_INPUT =
  "flex h-9 w-full rounded-none border bg-background px-3 py-1 text-sm outline-none"
const INPUT_OK = `${BASE_INPUT} border-[#ccc] focus:border-cog-teal`
const INPUT_DISABLED = `${BASE_INPUT} border-[#ccc] bg-muted text-muted-foreground`

function ProfilePage() {
  const db = useDb()
  const { user, userDoc } = useAuth()
  const { data: permDocs } = useCollection(permissionsCollection(db))
  const permNames = new Map(permDocs.map((d) => [d.id, d.name]))
  const { update, loading: saving } = useFirestoreMutation()

  const { register, handleSubmit, reset, watch, formState: { isDirty } } = useForm<ProfileFormValues>({
    defaultValues: {
      displayName: "",
      firstName: "",
      lastName: "",
      userType: "erwachsen",
      company: "",
      street: "",
      zip: "",
      city: "",
    },
  })

  const userType = watch("userType")
  const isFirma = userType === "firma"

  useEffect(() => {
    if (userDoc) {
      reset({
        displayName: userDoc.rawDisplayName ?? "",
        firstName: userDoc.firstName,
        lastName: userDoc.lastName,
        userType: userDoc.userType ?? "erwachsen",
        company: userDoc.billingAddress?.company ?? "",
        street: userDoc.billingAddress?.street ?? "",
        zip: userDoc.billingAddress?.zip ?? "",
        city: userDoc.billingAddress?.city ?? "",
      })
    }
  }, [userDoc, reset])

  const onSubmit = async (values: ProfileFormValues) => {
    if (!userDoc) return

    const data: Record<string, unknown> = {
      displayName: values.displayName.trim() || null,
      firstName: values.firstName,
      lastName: values.lastName,
      userType: values.userType,
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

    await update(userRef(db, userDoc.id), data, {
      successMessage: "Profil gespeichert",
    })
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <h2 className="text-xl font-bold font-body">Profil</h2>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <div className="bg-[rgba(204,204,204,0.2)] rounded-none p-[25px] space-y-4">
          <div className="space-y-1">
            <Label className="text-sm font-bold">Anzeigename (optional)</Label>
            <input
              placeholder="z.B. MikeS"
              {...register("displayName")}
              className={INPUT_OK}
            />
            <p className="text-xs text-muted-foreground">
              Falls leer, wird Vor- und Nachname angezeigt.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-sm font-bold">Vorname</Label>
              <input {...register("firstName")} className={INPUT_OK} />
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-bold">Nachname</Label>
              <input {...register("lastName")} className={INPUT_OK} />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-bold">E-Mail</Label>
            <input value={user?.email ?? ""} disabled className={INPUT_DISABLED} />
            <p className="text-xs text-muted-foreground">
              E-Mail kann nicht geändert werden.
            </p>
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
                <div className="space-y-1">
                  <Label className="text-sm font-bold">Firma</Label>
                  <input {...register("company")} className={INPUT_OK} />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-bold">Strasse</Label>
                  <input {...register("street")} className={INPUT_OK} />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-bold">PLZ</Label>
                  <input {...register("zip")} className={INPUT_OK} />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-bold">Ort</Label>
                  <input {...register("city")} className={INPUT_OK} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <div className="space-y-1">
            <Label className="text-sm font-bold">Rollen</Label>
            <div className="flex gap-1">
              {userDoc?.roles?.length ? (
                userDoc.roles.map((role) => (
                  <Badge key={role} variant="secondary">{role}</Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">–</span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-bold">Berechtigungen</Label>
            <div className="flex gap-1">
              {userDoc?.permissions?.length ? (
                userDoc.permissions.map((perm) => (
                  <Badge key={perm} variant="outline">{permNames.get(perm) ?? perm}</Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">–</span>
              )}
            </div>
          </div>
        </div>

        <div>
          <button
            type="submit"
            disabled={saving || !isDirty}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Speichern
          </button>
        </div>
      </form>
    </div>
  )
}
