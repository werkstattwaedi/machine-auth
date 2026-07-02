// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Self-service badge purchase dialog (kiosk). Opens when an identified
 * visitor taps an unregistered badge (or a pending pre-sign-in tap is
 * resumed). Shows the server-quoted price — free first badge for members /
 * permission holders, otherwise the catalog price — and on confirm adds
 * the badge as a line item via `billingCall/addBadgeToCheckout`. The
 * actual account association happens at checkout close.
 *
 * The quote is a `dryRun` of the same callable, so eligibility logic
 * exists exactly once, server-side (permissions aren't client-visible for
 * kiosk sessions).
 */

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { formatCHF } from "@modules/lib/format"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@modules/components/ui/alert-dialog"

export interface BadgePurchaseOffer {
  tokenId: string
  badgeVoucher: string
}

interface AddBadgeRequest {
  badgeVoucher: string
  dryRun?: boolean
}

interface AddBadgeResponse {
  checkoutId: string | null
  tokenId: string
  unitPrice: number
  free: boolean
}

function serverMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg.length > 0) return msg
  }
  return fallback
}

export function BadgePurchaseDialog({
  offer,
  onClose,
}: {
  /** The tapped unregistered badge; null keeps the dialog closed. */
  offer: BadgePurchaseOffer | null
  onClose: () => void
}) {
  const functions = useFunctions()
  const [quote, setQuote] = useState<AddBadgeResponse | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const purchase = useAsyncMutation<AddBadgeResponse>({
    context: "badge.addToCheckout",
    successMessage: "Badge zum Checkout hinzugefügt.",
    errorMessage: "Badge konnte nicht hinzugefügt werden.",
  })

  const voucher = offer?.badgeVoucher ?? null

  useEffect(() => {
    if (!voucher) {
      setQuote(null)
      setQuoteError(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const addBadge = rpcCallable<AddBadgeRequest, AddBadgeResponse>(
          functions,
          "billingCall",
          "addBadgeToCheckout"
        )
        const { data } = await addBadge({ badgeVoucher: voucher, dryRun: true })
        if (!cancelled) setQuote(data)
      } catch (err) {
        if (!cancelled) {
          setQuoteError(
            serverMessage(err, "Badge konnte nicht geprüft werden.")
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [voucher, functions])

  const confirm = async () => {
    if (!voucher) return
    try {
      await purchase.mutate(async () => {
        const addBadge = rpcCallable<AddBadgeRequest, AddBadgeResponse>(
          functions,
          "billingCall",
          "addBadgeToCheckout"
        )
        const { data } = await addBadge({ badgeVoucher: voucher })
        return data
      })
      onClose()
    } catch {
      // Toast + inline error already handled by useAsyncMutation (ADR-0025);
      // keep the dialog open so the user sees why.
    }
  }

  const inlineError =
    quoteError ??
    (purchase.error
      ? serverMessage(purchase.error.originalError, purchase.error.message)
      : null)

  return (
    <AlertDialog open={offer !== null}>
      <AlertDialogContent
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="badge-purchase-dialog"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Badge kaufen?</AlertDialogTitle>
          <AlertDialogDescription>
            Dieser Badge gehört noch niemandem. Beim Abschluss des Checkouts
            wird er deinem Konto zugewiesen.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-1" data-testid="badge-purchase-price">
          {inlineError ? (
            <p className="text-sm text-destructive" role="alert">
              {inlineError}
            </p>
          ) : quote ? (
            <p className="text-base">
              Preis:{" "}
              <span className="font-heading font-bold">
                {quote.free ? "Gratis (erster Badge)" : formatCHF(quote.unitPrice)}
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Preis wird ermittelt…
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogAction
            variant="outline"
            onClick={onClose}
            disabled={purchase.loading}
            data-testid="badge-purchase-cancel"
          >
            Abbrechen
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => void confirm()}
            disabled={!quote || !!quoteError || purchase.loading}
            data-testid="badge-purchase-confirm"
          >
            {purchase.loading && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            {quote?.free ? "Badge übernehmen" : "Badge kaufen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
