// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Person · Profil: «Kursleitung» (#842). Links the person to an edoobox
 * leader, making them a course leader (ADM-17), and lists the courses on
 * which the person is linked as a participant, each removable (ADM-18).
 * Both go through courseCall: the rules pin these fields for every client.
 */

import { useEffect, useState } from "react"
import { where } from "firebase/firestore"
import type { EdooboxLeader, ListEdooboxLeadersResult } from "@oww/shared"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { useCollection } from "@modules/lib/firestore"
import { courseLinksGroup, userRef } from "@modules/lib/firestore-helpers"
import type { UserDoc } from "@modules/lib/firestore-entities"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent } from "@modules/components/ui/card"
import { ConfirmDialog } from "@modules/components/confirm-dialog"
import { Label } from "@modules/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@modules/components/ui/select"
import { Check, Loader2 } from "lucide-react"

const NONE = "__none__"

export function CourseLeaderCard({ userId, user }: { userId: string; user: UserDoc }) {
  const db = useDb()
  const functions = useFunctions()
  const [leaders, setLeaders] = useState<EdooboxLeader[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string>(user.edooboxLeaderId ?? NONE)
  const [count, setCount] = useState<number | null>(null)
  const [unlink, setUnlink] = useState<{ offerId: string; participantId: string; title: string } | null>(null)
  const save = useAsyncMutation({ context: "admin.setEdooboxLeader", successMessage: "Gespeichert" })
  const remove = useAsyncMutation({ context: "admin.unlinkCourseParticipant", successMessage: "Verknüpfung gelöst" })
  const { data: links } = useCollection(courseLinksGroup(db), where("user", "==", userRef(db, userId)))

  useEffect(() => {
    rpcCallable<object, ListEdooboxLeadersResult>(functions, "courseCall", "listEdooboxLeaders")({})
      .then(({ data }) => setLeaders(data.leaders))
      .catch((err: { message?: string }) => setLoadError(err?.message ?? "edoobox ist nicht erreichbar."))
  }, [functions])

  useEffect(() => setPicked(user.edooboxLeaderId ?? NONE), [user.edooboxLeaderId])

  // The check: how many courses the picked leader has in edoobox.
  useEffect(() => {
    setCount(null)
    if (picked === NONE) return
    let stale = false
    rpcCallable<{ adminId: string }, { courses: number }>(functions, "courseCall", "countLeaderCourses")({ adminId: picked })
      .then(({ data }) => !stale && setCount(data.courses))
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [functions, picked])

  const dirty = picked !== (user.edooboxLeaderId ?? NONE)
  const onSave = async () => {
    await save
      .mutate(async () => {
        await rpcCallable(functions, "courseCall", "setEdooboxLeader")({ userId, adminId: picked === NONE ? null : picked })
      })
      .catch(() => undefined)
  }

  return (
    <Card className="mt-4 max-w-xl">
      <CardContent className="space-y-4 pt-6">
        <h3 className="font-heading text-lg font-bold">Kursleitung</h3>
        <div className="space-y-2">
          <Label htmlFor="edoobox-leader">edoobox-Leitung</Label>
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !leaders ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Select value={picked} onValueChange={setPicked}>
              <SelectTrigger id="edoobox-leader" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Keine</SelectItem>
                {leaders.map((l) => (
                  <SelectItem key={l.adminId} value={l.adminId} disabled={!!l.linkedUserId && l.linkedUserId !== userId}>
                    {l.name}
                    {l.linkedUserId && l.linkedUserId !== userId ? " (schon verknüpft)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {picked !== NONE && count !== null && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="size-4 text-emerald-600" aria-hidden="true" />
              {count} {count === 1 ? "Kurs" : "Kurse"} in edoobox
            </p>
          )}
        </div>
        <Button onClick={() => void onSave()} disabled={!dirty || save.loading}>
          Speichern
        </Button>

        {links.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <h4 className="font-semibold">Als Teilnehmer:in verknüpft</h4>
            <ul className="divide-y divide-border">
              {links.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    {l.offerTitle}
                    <span className="text-muted-foreground"> · als {l.participantName}</span>
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setUnlink({ offerId: l.offerId, participantId: l.id, title: l.offerTitle })}>
                    Verknüpfung lösen
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!unlink}
        onOpenChange={(o) => !o && setUnlink(null)}
        title="Verknüpfung lösen?"
        description={`Die Person ist danach nicht mehr mit «${unlink?.title ?? ""}» verknüpft; eine vorläufige Berechtigung aus diesem Kurs endet. Eine beim Abschluss erteilte Berechtigung bleibt.`}
        confirmLabel="Lösen"
        onConfirm={async () => {
          if (!unlink) return
          await remove
            .mutate(async () => {
              await rpcCallable(functions, "courseCall", "unlinkCourseParticipant")({ offerId: unlink.offerId, participantId: unlink.participantId })
            })
            .catch(() => undefined)
          setUnlink(null)
        }}
      />
    </Card>
  )
}
