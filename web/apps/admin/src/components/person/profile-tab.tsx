// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Person · Profil — one focused edit form, one Speichern. Contact data,
// user type and the admin role flag. Permissions live in their own tab.

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { userRef } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import type { UserDoc } from "@modules/lib/firestore-entities"
import { formatDateTime } from "@modules/lib/format"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent } from "@modules/components/ui/card"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { Loader2, Save } from "lucide-react"

interface ProfileFormValues {
  firstName: string
  lastName: string
  email: string
  phone: string
  isAdmin: boolean
  userType: string
  company: string
  street: string
  zip: string
  city: string
}

export function PersonProfileTab({
  userId,
  user,
}: {
  userId: string
  user: UserDoc
}) {
  const db = useDb()
  const { update, loading: saving } = useFirestoreMutation()
  const { register, handleSubmit, reset, watch } = useForm<ProfileFormValues>()
  const userType = watch("userType")
  const isFirma = userType === "firma"

  useEffect(() => {
    reset({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      email: user.email ?? "",
      phone: user.phone ?? "",
      isAdmin: user.roles?.includes("admin") ?? false,
      userType: user.userType ?? "erwachsen",
      company: user.billingAddress?.company ?? "",
      street: user.billingAddress?.street ?? "",
      zip: user.billingAddress?.zip ?? "",
      city: user.billingAddress?.city ?? "",
    })
  }, [user, reset])

  const onSubmit = async (values: ProfileFormValues) => {
    // Roles only carry authorization flags (currently just "admin");
    // membership is its own entity and no longer lives in roles.
    const roles: string[] = []
    if (values.isAdmin) roles.push("admin")

    const hasAddress = values.street || values.zip || values.city
    await update(
      userRef(db, userId),
      {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email || null,
        phone: values.phone || null,
        roles,
        userType: values.userType as UserDoc["userType"],
        billingAddress: hasAddress
          ? {
              company: isFirma ? values.company : "",
              street: values.street,
              zip: values.zip,
              city: values.city,
            }
          : null,
      },
      { successMessage: "Profil gespeichert" },
    )
  }

  return (
    <Card className="mt-2 max-w-xl">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">Vorname</Label>
              <Input id="firstName" {...register("firstName")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Nachname</Label>
              <Input id="lastName" {...register("lastName")} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input id="email" type="email" {...register("email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefon</Label>
              <Input id="phone" {...register("phone")} />
            </div>
          </div>
          <div className="max-w-56 space-y-2">
            <Label htmlFor="userType">Benutzertyp</Label>
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
            <div className="space-y-2">
              <Label htmlFor="company">Firma</Label>
              <Input id="company" {...register("company")} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="street">Strasse</Label>
            <Input id="street" {...register("street")} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="zip">PLZ</Label>
              <Input id="zip" {...register("zip")} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="city">Ort</Label>
              <Input id="city" {...register("city")} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="isAdmin" checked={undefined} {...register("isAdmin")} />
            <Label htmlFor="isAdmin">Administrator</Label>
          </div>

          {user.termsAcceptedAt && (
            <div className="text-sm text-muted-foreground">
              Nutzungsbestimmungen akzeptiert am {formatDateTime(user.termsAcceptedAt)}
            </div>
          )}

          <Button type="submit" disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Speichern
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
