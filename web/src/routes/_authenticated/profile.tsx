// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { useCollection } from "@/lib/firestore"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useForm } from "react-hook-form"
import { Loader2, Save } from "lucide-react"
import { useEffect } from "react"

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

function ProfilePage() {
  const { user, userDoc } = useAuth()
  const { data: permDocs } = useCollection<{ name: string }>("permission")
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

    await update("users", userDoc.id, data, {
      successMessage: "Profil gespeichert",
    })
  }

  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="text-2xl font-bold">Profil</h1>

      <Card>
        <CardHeader>
          <CardTitle>{userDoc?.displayName ?? "Unbekannt"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Anzeigename (optional)</Label>
              <Input id="displayName" placeholder="z.B. MikeS" {...register("displayName")} />
              <p className="text-xs text-muted-foreground">
                Falls leer, wird Vor- und Nachname angezeigt.
              </p>
            </div>

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

            <div className="space-y-2">
              <Label>E-Mail</Label>
              <Input value={user?.email ?? ""} disabled />
              <p className="text-xs text-muted-foreground">
                E-Mail kann nicht geändert werden.
              </p>
            </div>

            <div className="space-y-2">
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
              <div className="space-y-4 rounded border p-4">
                <h4 className="text-sm font-semibold">Rechnungsadresse</h4>
                <div className="space-y-2">
                  <Label htmlFor="company">Firma</Label>
                  <Input id="company" {...register("company")} />
                </div>
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
              </div>
            )}

            <div className="space-y-2">
              <Label>Rollen</Label>
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

            <div className="space-y-2">
              <Label>Berechtigungen</Label>
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

            <Button type="submit" disabled={saving || !isDirty}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Speichern
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
