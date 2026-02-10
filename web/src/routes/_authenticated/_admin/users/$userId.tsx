// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useDocument, useCollection } from "@/lib/firestore"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { permissionRef, userRef } from "@/lib/firestore-helpers"
import { where } from "firebase/firestore"
import { PageLoading } from "@/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime } from "@/lib/format"
import { useForm } from "react-hook-form"
import { Loader2, Save, Plus, Ban, RotateCcw } from "lucide-react"
import { useEffect, useState } from "react"
import { type DocumentReference } from "firebase/firestore"

export const Route = createFileRoute("/_authenticated/_admin/users/$userId")({
  component: UserDetailPage,
})

interface UserDoc {
  displayName: string
  name: string
  email?: string
  roles: string[]
  permissions: (DocumentReference | { id: string })[]
  termsAcceptedAt?: { toDate(): Date } | null
  userType?: string
}

interface PermissionDoc {
  name: string
}

interface TokenDoc {
  userId: DocumentReference | { id: string }
  label?: string
  registered?: { toDate(): Date }
  deactivated?: { toDate(): Date } | null
}

interface UserFormValues {
  displayName: string
  name: string
  email: string
  isAdmin: boolean
  userType: string
}

function UserDetailPage() {
  const { userId } = Route.useParams()
  const { data: user, loading } = useDocument<UserDoc>(`users/${userId}`)
  const { data: allPermissions } = useCollection<PermissionDoc>("permission")
  const { data: tokens, loading: tokensLoading } = useCollection<TokenDoc>(
    "tokens",
    where("userId", "==", userRef(userId))
  )
  const { update, loading: saving } = useFirestoreMutation()
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [newTagId, setNewTagId] = useState("")

  const { register, handleSubmit, reset } = useForm<UserFormValues>()

  useEffect(() => {
    if (user) {
      const perms = (user.permissions ?? []).map((p) =>
        typeof p === "string" ? p : p.id
      )
      setSelectedPermissions(perms)
      reset({
        displayName: user.displayName,
        name: user.name,
        email: user.email ?? "",
        isAdmin: user.roles?.includes("admin") ?? false,
        userType: user.userType ?? "erwachsen",
      })
    }
  }, [user, reset])

  if (loading) return <PageLoading />
  if (!user) return <div>Benutzer nicht gefunden.</div>

  const onSubmit = async (values: UserFormValues) => {
    const roles: string[] = ["vereinsmitglied"]
    if (values.isAdmin) roles.push("admin")

    await update("users", userId, {
      displayName: values.displayName,
      name: values.name,
      email: values.email,
      roles,
      userType: values.userType,
      permissions: selectedPermissions.map((id) => permissionRef(id)),
    }, {
      successMessage: "Benutzer gespeichert",
    })
  }

  const togglePermission = (permId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    )
  }

  const handleAddTag = async () => {
    if (!newTagId.trim()) return
    const { set } = await import("firebase/firestore").then((m) => ({
      set: m.setDoc,
    }))
    const { doc: docFn } = await import("firebase/firestore")
    const { db } = await import("@/lib/firebase")
    const { serverTimestamp } = await import("firebase/firestore")
    await set(docFn(db, "tokens", newTagId.trim()), {
      userId: userRef(userId),
      label: "",
      registered: serverTimestamp(),
      modifiedBy: null,
      modifiedAt: serverTimestamp(),
    })
    setNewTagId("")
  }

  const handleToggleTag = async (tokenId: string, isDeactivated: boolean) => {
    const { updateDoc, doc: docFn, serverTimestamp } = await import("firebase/firestore")
    const { db } = await import("@/lib/firebase")
    await updateDoc(docFn(db, "tokens", tokenId), {
      deactivated: isDeactivated ? null : serverTimestamp(),
      modifiedAt: serverTimestamp(),
    })
  }

  return (
    <div>
      <PageHeader title={user.displayName || "Benutzer"} backTo="/users" backLabel="Zurück zu Benutzer" />

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="usage">Nutzung</TabsTrigger>
          <TabsTrigger value="audit">Verlauf</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-lg">
                <div className="space-y-2">
                  <Label htmlFor="displayName">Anzeigename</Label>
                  <Input id="displayName" {...register("displayName")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Vollständiger Name</Label>
                  <Input id="name" {...register("name")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">E-Mail</Label>
                  <Input id="email" type="email" {...register("email")} />
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
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="isAdmin"
                    checked={undefined}
                    {...register("isAdmin")}
                  />
                  <Label htmlFor="isAdmin">Administrator</Label>
                </div>

                <div className="space-y-2">
                  <Label>Berechtigungen</Label>
                  <div className="flex flex-wrap gap-2">
                    {allPermissions.map((perm) => (
                      <Badge
                        key={perm.id}
                        variant={selectedPermissions.includes(perm.id) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => togglePermission(perm.id)}
                      >
                        {perm.name || perm.id}
                      </Badge>
                    ))}
                  </div>
                </div>

                {user.termsAcceptedAt && (
                  <div className="text-sm text-muted-foreground">
                    Nutzungsbestimmungen akzeptiert am {formatDateTime(user.termsAcceptedAt)}
                  </div>
                )}

                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Speichern
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tags">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">NFC Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Tag UID (hex, z.B. 04c339aa1e1890)"
                    value={newTagId}
                    onChange={(e) => setNewTagId(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button onClick={handleAddTag} disabled={!newTagId.trim()}>
                    <Plus className="h-4 w-4 mr-2" />
                    Tag hinzufügen
                  </Button>
                </div>

                {tokensLoading ? (
                  <PageLoading />
                ) : tokens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Tags zugewiesen.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tag UID</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Registriert</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tokens.map((token) => {
                        const isDeactivated = !!token.deactivated
                        return (
                          <TableRow key={token.id}>
                            <TableCell className="font-mono text-xs">{token.id}</TableCell>
                            <TableCell>{token.label || "–"}</TableCell>
                            <TableCell>{formatDateTime(token.registered)}</TableCell>
                            <TableCell>
                              {isDeactivated ? (
                                <Badge variant="destructive">Deaktiviert</Badge>
                              ) : (
                                <Badge variant="secondary">Aktiv</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleToggleTag(token.id, isDeactivated)}
                              >
                                {isDeactivated ? (
                                  <><RotateCcw className="h-3 w-3 mr-1" />Aktivieren</>
                                ) : (
                                  <><Ban className="h-3 w-3 mr-1" />Deaktivieren</>
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Nutzungsdaten werden in Phase 3 implementiert.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Audit-Log wird in Phase 4 implementiert.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
