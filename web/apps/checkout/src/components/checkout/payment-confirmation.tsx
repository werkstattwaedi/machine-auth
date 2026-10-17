// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The confirmation inside the payment frame once the checkout closed
 * (issue #750; replaces the completion dialog): an animated check with the
 * status, a green box saying what was sent where, and below it what the
 * device may offer — the PDF on the person's own device (never the kiosk,
 * BIL-15), the QR slip behind a disclosure after a QR-Rechnung (desktop and
 * kiosk, never a phone), and the paylink again after TWINT in case its
 * window didn't open.
 */

import { QRCodeSVG } from "qrcode.react"
import { ChevronDown, Download, ExternalLink, Loader2 } from "lucide-react"
import { useFunctions } from "@modules/lib/firebase-context"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { rpcCallable } from "@modules/lib/rpc"
import { cn } from "@modules/lib/utils"
import {
  KASSE_EMAIL,
  PAYMENT_CHOICE_UI,
  SWISS_CROSS_SVG,
  type ChoiceCopyContext,
  type PaymentChoice,
  type PaymentData,
} from "./payment-methods"
import { ChoiceIcon } from "./payment-options"
import "./payment-confirmation.css"

/** How long the PDF link keeps asking while the PDF is still being made. */
const PDF_RETRY_DELAY_MS = 2_000
const PDF_MAX_ATTEMPTS = 15

interface PaymentConfirmationProps {
  choice: PaymentChoice
  /**
   * The close's answer. Null after a terminal payment: this screen never
   * closed anything — Wallee's confirmation does (ADR-0051).
   */
  paymentData: PaymentData | null
  copy: ChoiceCopyContext
  /** The person's own device: offers the PDF (BIL-15). */
  ownDevice: boolean
  /** Phone-width: no QR slip (nobody scans their own screen). */
  isPhone: boolean
  qrOpen: boolean
  onQrOpenChange: (open: boolean) => void
  /** Test seam: waits between PDF attempts. */
  sleep?: (ms: number) => Promise<void>
}

export function PaymentConfirmation({
  choice,
  paymentData,
  copy,
  ownDevice,
  isPhone,
  qrOpen,
  onQrOpenChange,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: PaymentConfirmationProps) {
  const ui = PAYMENT_CHOICE_UI[choice]
  const box = ui.doneBox?.(copy) ?? null
  // A badge or signed-in account without an e-mail address gets no mail
  // (the server finds no recipient, #651): don't claim one was sent.
  const noRecipient = choice !== "free" && !copy.email.trim()
  const showQr = choice === "rechnung" && !isPhone

  return (
    <div className="flex flex-col gap-5" data-testid="payment-confirmation">
      <div className="flex items-center gap-4">
        <ChoiceIcon choice={choice} />
        <span className="font-heading font-semibold text-[17px] leading-tight flex-1 min-w-0">
          {ui.title}
        </span>
      </div>

      <div className="flex items-center gap-3" role="status">
        <AnimatedCheck />
        <span className="font-heading font-bold text-xl text-foreground">
          {noRecipient ? PAYMENT_CHOICE_UI.free.doneStatus : ui.doneStatus}
        </span>
      </div>

      {box && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 leading-relaxed">
          {box}
        </div>
      )}

      {noRecipient && (
        <div
          data-testid="no-recipient"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 leading-relaxed"
        >
          Wir haben keine E-Mail-Adresse von dir und konnten dir nichts schicken.
          Melde dich bei{" "}
          <a href={`mailto:${KASSE_EMAIL}`} className="font-semibold underline">
            {KASSE_EMAIL}
          </a>
          .
        </div>
      )}

      {ui.doneNote && (
        <p className="text-sm text-muted-foreground leading-relaxed">{ui.doneNote}</p>
      )}

      {choice === "raisenow" && paymentData?.paylinkUrl && (
        <a
          href={paymentData.paylinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start inline-flex items-center gap-1.5 text-sm font-bold text-cog-teal hover:text-cog-teal-dark"
        >
          <ExternalLink className="h-4 w-4" />
          TWINT-Zahlung nochmals öffnen
        </a>
      )}

      {ownDevice && paymentData && (
        <PdfDownloadLink billId={paymentData.billId} sleep={sleep} />
      )}

      {showQr && (
        <div>
          <button
            type="button"
            aria-expanded={qrOpen}
            onClick={() => onQrOpenChange(!qrOpen)}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-cog-teal hover:text-cog-teal-dark"
          >
            Gleich bezahlen? QR-Code anzeigen
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", qrOpen && "rotate-180")}
            />
          </button>
          {qrOpen && paymentData && <QrSlip paymentData={paymentData} />}
        </div>
      )}
    </div>
  )
}

function AnimatedCheck() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden
      className="shrink-0 text-emerald-600"
    >
      <circle
        className="pc-check-circle"
        cx="14"
        cy="14"
        r="12"
        stroke="currentColor"
        strokeWidth="2"
        transform="rotate(-90 14 14)"
      />
      <path
        className="pc-check-tick"
        d="M8.5 14.5l3.5 3.5 7.5-8"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * "PDF herunterladen". The PDF is made after the commit, asynchronously, so
 * the first ask can find none yet (`failed-precondition`): keep asking for a
 * while with a spinner instead of failing.
 */
function PdfDownloadLink({
  billId,
  sleep,
}: {
  billId: string
  sleep: (ms: number) => Promise<void>
}) {
  const functions = useFunctions()
  // ADR-0025: the hook owns the toast; it only fires once the retries ran out.
  const download = useAsyncMutation<string>({
    context: "checkout.downloadInvoice",
    errorMessage: "PDF konnte nicht geladen werden.",
  })

  const handleClick = () => {
    const getUrl = rpcCallable<{ billId: string }, { url: string }>(
      functions,
      "billingCall",
      "getInvoiceDownloadUrl",
    )
    void download
      .mutate(async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            return (await getUrl({ billId })).data.url
          } catch (err) {
            const notYet =
              (err as { code?: string }).code === "functions/failed-precondition"
            if (!notYet || attempt >= PDF_MAX_ATTEMPTS) throw err
            await sleep(PDF_RETRY_DELAY_MS)
          }
        }
      })
      .then((url) => {
        // A synthetic anchor click, not window.open: after the awaits the
        // user gesture is gone and popup blockers would swallow a new
        // window. The signed URL is served as an attachment, so the page
        // stays where it is.
        const a = document.createElement("a")
        a.href = url
        a.rel = "noopener"
        a.target = "_self"
        document.body.appendChild(a)
        a.click()
        a.remove()
      })
      .catch(() => {
        // Hook already toasted + telemetered.
      })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={download.loading}
      className="self-start inline-flex items-center gap-1.5 text-sm font-bold text-cog-teal hover:text-cog-teal-dark disabled:opacity-70"
    >
      {download.loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      PDF herunterladen
    </button>
  )
}

function QrSlip({ paymentData }: { paymentData: PaymentData }) {
  return (
    <div className="mt-4 flex flex-col sm:flex-row gap-6">
      <div
        data-testid="payment-qr"
        className="shrink-0 rounded-md border border-border p-3 bg-white self-start"
      >
        <QRCodeSVG
          value={paymentData.qrBillPayload}
          size={180}
          level="M"
          imageSettings={{
            src: SWISS_CROSS_SVG,
            height: 34,
            width: 34,
            excavate: true,
          }}
        />
      </div>
      <div className="flex flex-col gap-4 text-sm min-w-0">
        <p className="text-muted-foreground">
          Scanne den QR-Code mit deiner E-Banking-App.
        </p>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Konto / Zahlbar an
          </p>
          <p className="font-mono">{paymentData.creditor.iban}</p>
          <p>{paymentData.creditor.name}</p>
          {paymentData.creditor.street && (
            <p className="text-muted-foreground">{paymentData.creditor.street}</p>
          )}
          <p className="text-muted-foreground">{paymentData.creditor.location}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Referenz
          </p>
          <p className="font-mono">{paymentData.reference}</p>
        </div>
      </div>
    </div>
  )
}
