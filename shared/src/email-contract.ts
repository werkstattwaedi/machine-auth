// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Contract between the functions that send transactional mail and the
 * generator in the operations repo that builds and publishes the Resend
 * templates (ADR-0046).
 *
 * Each mail declares its build-time dimensions (one published template per
 * combination) and the variables the function fills in at send time. The
 * function resolves a template through `templateAlias`; the generator
 * enumerates the same combinations and refuses to publish a template whose
 * placeholders differ from `variables`. Resend rejects a send that misses a
 * declared variable, so the two sides must agree exactly.
 *
 * Kept free of imports: the operations repo loads this file straight from
 * the sibling checkout.
 */

/** Environment prefix of every alias; staging and prod publish separately. */
export const EMAIL_ENVS = ["prod", "staging", "test"] as const
export type EmailEnv = (typeof EMAIL_ENVS)[number]

/**
 * Which mail announces a bill (`bill-<value>`), chosen by `billMailFor` from
 * the bill's document and payment-method *properties*, never from a method
 * id — new payment integrations must not add templates. Not the document
 * itself (`BillDocumentType`): a Beleg for the Sammelrechnung and a Beleg
 * for a payment the customer made during the checkout say different things.
 */
export const BILL_MAILS = [
  "invoice",
  "receipt",
  "paid-beleg",
  "beleg",
  "free",
  "sammelrechnung",
] as const
export type BillMail = (typeof BILL_MAILS)[number]

/**
 * What a checkout was (issue #660): a workshop visit, a membership
 * purchase, or a plain purchase (badge, material) without a visit. Decided
 * by `classifyCheckoutKind`; declared here because it is a mail dimension.
 */
export const CHECKOUT_KINDS = ["visit", "membership", "purchase"] as const
export type CheckoutKind = (typeof CHECKOUT_KINDS)[number]

interface MailSpec {
  /** Build-time dimensions, in alias order. */
  readonly dims: Readonly<Record<string, readonly string[]>>
  /** Send-time variables, exactly as the template uses them. */
  readonly variables: readonly string[]
}

export const EMAIL_CONTRACT = {
  login: {
    dims: {},
    variables: ["CODE", "MAGIC_LINK", "EXPIRES_MINUTES"],
  },
  invite: {
    dims: {},
    variables: ["INVITER_NAME", "MEMBERSHIP_NAME", "ACCEPT_LINK"],
  },
  "checkout-reminder": {
    dims: {},
    variables: ["RECIPIENT_NAME", "CHECKOUT_DATE", "CHECKOUT_LINK", "STALE_DAYS"],
  },
  "account-instructions": {
    dims: {},
    variables: ["GREETING"],
  },
  // Payable QR-bill invoice for a single checkout.
  "bill-invoice": {
    dims: { kind: CHECKOUT_KINDS },
    variables: ["RECIPIENT_NAME", "CHECKOUT_DATE", "INVOICE_NUMBER", "AMOUNT", "CURRENCY"],
  },
  // Quittung for a payment the provider confirmed during the checkout
  // (`confirmsPayment`), no QR slip — and for an earlier RaiseNow bill.
  // PAYMENT_LABEL is the method's brand ("TWINT"), never part of the alias.
  "bill-receipt": {
    dims: { kind: CHECKOUT_KINDS },
    variables: [
      "RECIPIENT_NAME",
      "CHECKOUT_DATE",
      "INVOICE_NUMBER",
      "AMOUNT",
      "CURRENCY",
      "KASSE_EMAIL",
      "PAYMENT_LABEL",
    ],
  },
  // Beleg for a payment the customer says they made during the checkout
  // (`paidDuringCheckout` without `confirmsPayment`, #763): no QR slip, and
  // the copy never says the payment was received (BIL-6).
  "bill-paid-beleg": {
    dims: { kind: CHECKOUT_KINDS },
    variables: [
      "RECIPIENT_NAME",
      "CHECKOUT_DATE",
      "INVOICE_NUMBER",
      "AMOUNT",
      "CURRENCY",
      "KASSE_EMAIL",
      "PAYMENT_LABEL",
    ],
  },
  // Per-checkout Beleg queued for the Sammelrechnung (`isAggregated`). Not
  // payable — must never share copy with the Sammelrechnung (issue #502).
  "bill-beleg": {
    dims: { kind: CHECKOUT_KINDS },
    variables: ["RECIPIENT_NAME", "CHECKOUT_DATE", "INVOICE_NUMBER", "AMOUNT", "CURRENCY", "KASSE_EMAIL"],
  },
  // Beleg of a checkout totalling CHF 0 (BIL-8, #790): no amount, no slip,
  // and the copy says there is nothing to pay (BIL-45).
  "bill-free": {
    dims: { kind: CHECKOUT_KINDS },
    variables: ["RECIPIENT_NAME", "CHECKOUT_DATE", "INVOICE_NUMBER"],
  },
  // The monthly aggregate of Belege — payable, QR slip attached.
  "bill-sammelrechnung": {
    dims: {},
    variables: ["RECIPIENT_NAME", "INVOICE_NUMBER", "AMOUNT", "CURRENCY", "KASSE_EMAIL"],
  },
  "membership-renewal": {
    dims: {},
    variables: ["RECIPIENT_NAME", "INVOICE_NUMBER", "AMOUNT", "CURRENCY"],
  },
  // Corrected re-issue of any document (ADR-0042).
  "bill-correction": {
    dims: {},
    variables: [
      "RECIPIENT_NAME",
      "INVOICE_NUMBER",
      "AMOUNT",
      "CURRENCY",
      "KASSE_EMAIL",
      "DOCUMENT_KIND",
      "SUPERSEDED_INVOICE_NUMBER",
      "REASON",
      "PAYMENT_NOTE",
      "CORRECTION_DETAILS",
    ],
  },
  // Pure cancellation without replacement (ADR-0042).
  "bill-cancellation": {
    dims: {},
    variables: [
      "RECIPIENT_NAME",
      "INVOICE_NUMBER",
      "AMOUNT",
      "CURRENCY",
      "KASSE_EMAIL",
      "DOCUMENT_KIND",
      "REASON",
      "PAYMENT_NOTE",
    ],
  },
} as const satisfies Record<string, MailSpec>

export type MailName = keyof typeof EMAIL_CONTRACT
export const MAIL_NAMES = Object.keys(EMAIL_CONTRACT) as MailName[]

export type MailDims<M extends MailName> = {
  -readonly [K in keyof (typeof EMAIL_CONTRACT)[M]["dims"]]: (typeof EMAIL_CONTRACT)[M]["dims"][K] extends readonly (infer V)[]
    ? V
    : never
}

export type MailVariables<M extends MailName> = Record<
  (typeof EMAIL_CONTRACT)[M]["variables"][number],
  string
>

/** The contract mail name of a bill mail. */
export function billMail(mail: BillMail): MailName {
  return `bill-${mail}` as const
}

export function isEmailEnv(value: unknown): value is EmailEnv {
  return typeof value === "string" && (EMAIL_ENVS as readonly string[]).includes(value)
}

/**
 * Resend alias of one published template: `<env>-<mail>[-<dim value>…]`,
 * dimension values in the contract's declaration order.
 */
export function templateAlias<M extends MailName>(
  env: EmailEnv,
  mail: M,
  dims: MailDims<M>,
): string {
  const spec: MailSpec = EMAIL_CONTRACT[mail]
  const values = Object.keys(spec.dims).map((key) => {
    const value = (dims as Record<string, string>)[key]
    if (!spec.dims[key].includes(value)) {
      throw new Error(`Invalid ${key} "${value}" for mail ${mail}`)
    }
    return value
  })
  return [env, mail, ...values].join("-")
}

/** Every dimension combination of a mail — one published template each. */
export function mailCombinations<M extends MailName>(mail: M): MailDims<M>[] {
  const spec: MailSpec = EMAIL_CONTRACT[mail]
  let combos: Record<string, string>[] = [{}]
  for (const [key, values] of Object.entries(spec.dims)) {
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [key]: value })))
  }
  return combos as MailDims<M>[]
}
