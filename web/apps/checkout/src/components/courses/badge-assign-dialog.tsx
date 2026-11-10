// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * «Badge zuweisen» at the kiosk (#842, CRS-9): waits for a tap on the
 * reader and registers an unregistered badge to the participant's linked
 * account, free. Listens to the bridge itself while open — the kiosk's tap
 * router ignores taps in the account area (KIO-6), so the two never both act.
 * The tap is proven by probeTag's voucher, never by a bare tag id.
 */

import { useEffect, useRef, useState } from "react"
import { COURSE_MESSAGE_CODES } from "@/lib/courses"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { resolveBridgeBearer, useBridge } from "@modules/lib/use-bridge"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Button } from "@modules/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { ReaderScene } from "@/components/checkout/nfc-badge-affordance"

export interface BadgeAssignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  offerId: string
  participantId: string
  /** «Luca Meier» */
  personName: string
  onAssigned: () => void
}

export function parseTapUrl(url: string | null | undefined): { picc: string; cmac: string } | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const picc = u.searchParams.get("picc") ?? u.searchParams.get("e")
    const cmac = u.searchParams.get("cmac") ?? u.searchParams.get("m")
    return picc && cmac ? { picc, cmac } : null
  } catch {
    return null
  }
}

export function BadgeAssignDialog({ open, onOpenChange, offerId, participantId, personName, onAssigned }: BadgeAssignDialogProps) {
  const bridge = useBridge()
  const functions = useFunctions()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const assign = useAsyncMutation({
    context: "courses.assignBadge",
    successMessage: "Badge zugewiesen",
    serverMessageCodes: COURSE_MESSAGE_CODES,
  })
  // The listener reads these through refs, so it subscribes once per opening.
  const mutateRef = useRef(assign.mutate)
  mutateRef.current = assign.mutate
  const doneRef = useRef({ onAssigned, onOpenChange })
  doneRef.current = { onAssigned, onOpenChange }

  useEffect(() => {
    if (!open || !bridge.available) return
    return bridge.onNfcTag(async ({ url }) => {
      if (busyRef.current) return
      const tap = parseTapUrl(url)
      if (!tap) {
        toast.error("Der Badge konnte nicht gelesen werden. Bitte nochmals auflegen.")
        return
      }
      busyRef.current = true
      setBusy(true)
      try {
        const bearer = await resolveBridgeBearer()
        let data: { tokenId: string; registered: boolean; badgeVoucher?: string }
        try {
          ;({ data } = await rpcCallable<
            { picc: string; cmac: string; bearer?: string },
            { tokenId: string; registered: boolean; badgeVoucher?: string }
          >(functions, "authCall", "probeTag")({ ...tap, bearer: bearer ?? undefined }))
        } catch {
          toast.error("Der Badge konnte nicht geprüft werden. Bitte nochmals auflegen.")
          return
        }
        if (data.registered || !data.badgeVoucher) {
          toast.error("Dieser Badge ist schon registriert. Bitte einen neuen Badge auflegen.")
          return
        }
        const badgeVoucher = data.badgeVoucher
        await mutateRef.current(async () => {
          await rpcCallable(functions, "courseCall", "assignCourseBadge")({ offerId, participantId, badgeVoucher })
        })
        doneRef.current.onAssigned()
        doneRef.current.onOpenChange(false)
      } catch {
        // The hook toasted the assign failure.
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    })
  }, [open, bridge, functions, offerId, participantId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Badge zuweisen</DialogTitle>
          <DialogDescription>Der Badge gehört danach {personName}.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <ReaderScene />
          <p className="flex items-center gap-2 font-semibold">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {busy ? "Badge wird zugewiesen …" : "Neuen Badge an den Leser halten"}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
