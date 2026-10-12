// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared Resend "send a templated email" helper. Templates are generated
 * and published from the operations repo against the contract in
 * `@oww/shared` `email-contract.ts` (ADR-0046); this side only resolves the
 * alias for a mail + its dimensions and passes exactly the contract's
 * variables, so no template id is configured per mail.
 *
 * The helper deliberately does NOT auto-skip in emulator mode — callers
 * already branch (`if (isEmulator()) { logger.info(...) } else { send(...) }`)
 * because the in-emulator surface (log line, debug doc field) is part of
 * the contract with E2E tests, not an internal detail.
 */

import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError } from "firebase-functions/v2/https";
import {
  EMAIL_CONTRACT,
  isEmailEnv,
  templateAlias,
  type EmailEnv,
  type MailDims,
  type MailName,
  type MailVariables,
} from "@oww/shared";

export const resendApiKey = defineSecret("RESEND_API_KEY");
export const resendFromEmail = defineString("RESEND_FROM_EMAIL");
// "prod" / "staging" — which environment's published templates to use.
// No default: an unset value must fail loudly rather than send with an
// alias Resend does not know (an opaque provider error, issue #149).
const resendTemplateEnv = defineString("RESEND_TEMPLATE_ENV");

/**
 * Parses the template environment, throwing `failed-precondition` when it
 * is unset or unknown outside the emulator. The emulator never sends mail,
 * so it falls back to "test" there.
 */
export function templateEnvFrom(value: string): EmailEnv {
  const env = value.trim();
  if (isEmailEnv(env)) return env;
  if (process.env.FUNCTIONS_EMULATOR === "true") return "test";
  logger.error(
    `RESEND_TEMPLATE_ENV is "${env}" — expected prod, staging or test. ` +
      "Emails cannot be sent. Set functions.resendTemplateEnv in the " +
      "operations config and regenerate the env files (`npm run generate-env`)."
  );
  throw new HttpsError("failed-precondition", "Resend template environment not configured");
}

/** The `template` field of a Resend send for one mail of the contract. */
export function templateRef<M extends MailName>(
  mail: M,
  dims: MailDims<M>,
  variables: MailVariables<M>
): { id: string; variables: Record<string, string> } {
  return {
    id: templateAlias(templateEnvFrom(resendTemplateEnv.value()), mail, dims),
    variables: Object.fromEntries(
      Object.entries(variables as Record<string, string>).map(([name, value]) => [
        name,
        stripMarkup(value),
      ])
    ),
  };
}

/**
 * Resend substitutes `{{{VARIABLES}}}` unescaped, and several carry user
 * input (a name typed at check-in, an inviter's family name) into a mail
 * that may go to someone else. Dropping `<` and `>` rules out injected
 * markup; entity-escaping instead would show `&amp;` in the plain-text
 * part, which receives the same values. No legitimate value (names, dates,
 * URLs, amounts) contains either character.
 */
export function stripMarkup(value: string): string {
  return value.replace(/[<>]/g, "");
}

/**
 * Picks exactly the contract's variables of `mail` out of a superset — for
 * senders that serve several mails from one payload (the bill trigger).
 * Throws on a missing one: Resend would reject the send anyway, with a
 * less telling error.
 */
export function contractVariables<M extends MailName>(
  mail: M,
  all: Readonly<Record<string, string>>
): MailVariables<M> {
  const names: readonly string[] = EMAIL_CONTRACT[mail].variables;
  const missing = names.filter((name) => all[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Mail ${mail} needs ${missing.join(", ")}`);
  }
  return Object.fromEntries(names.map((name) => [name, all[name]])) as MailVariables<M>;
}

export interface SendTemplateInput<M extends MailName> {
  to: string;
  mail: M;
  dims: MailDims<M>;
  variables: MailVariables<M>;
}

/**
 * Send a templated email via Resend.
 *
 * Caller must declare `resendApiKey` in `onCall({ secrets: [...] })` so the
 * value is available when this runs.
 */
export async function sendTemplate<M extends MailName>(
  input: SendTemplateInput<M>
): Promise<void> {
  const { to, mail, dims, variables } = input;
  const template = templateRef(mail, dims, variables);
  // Lazy import: keeps the Resend SDK out of the cold-start bundle for
  // every other function (resend_template is reachable from index.ts via
  // requestLoginCode and inviteFamilyMember exports).
  const { Resend } = await import("resend");
  const resend = new Resend(resendApiKey.value());
  const { error } = await resend.emails.send({
    from: resendFromEmail.value(),
    to,
    template,
  });
  if (error) {
    logger.error("Resend send failed", { error, template: template.id });
    throw new HttpsError("internal", "Email send failed");
  }
}
