// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
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
  name: string
}

function ProfilePage() {
  const { user, userDoc } = useAuth()
  const { update, loading: saving } = useFirestoreMutation()

  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<ProfileFormValues>({
    defaultValues: {
      displayName: userDoc?.displayName ?? "",
      name: userDoc?.name ?? "",
    },
  })

  // Reset form when userDoc changes (initial load)
  useEffect(() => {
    if (userDoc) {
      reset({
        displayName: userDoc.displayName,
        name: userDoc.name,
      })
    }
  }, [userDoc, reset])

  const onSubmit = async (values: ProfileFormValues) => {
    if (!userDoc) return
    await update("users", userDoc.id, values, {
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
              <Label htmlFor="displayName">Anzeigename</Label>
              <Input id="displayName" {...register("displayName")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Vollständiger Name</Label>
              <Input id="name" {...register("name")} />
            </div>

            <div className="space-y-2">
              <Label>E-Mail</Label>
              <Input value={user?.email ?? ""} disabled />
              <p className="text-xs text-muted-foreground">
                E-Mail kann nicht geändert werden.
              </p>
            </div>

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
                    <Badge key={perm} variant="outline">{perm}</Badge>
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
