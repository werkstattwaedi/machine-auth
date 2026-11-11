// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// The HTML5 `type=email` shape (ASCII local part, LDH domain labels, at least
// one dot), plus the dot rules RFC 5321 adds for the local part. It has to be
// at least as strict as Resend's recipient check: anything this accepts but
// Resend refuses reaches the mail send as a 422 and fails there instead of at
// input validation.
const EMAIL_ADDRESS_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/** Whether `email` (already trimmed) is an address we can send mail to. */
export function isValidEmailAddress(email: string): boolean {
  if (!EMAIL_ADDRESS_RE.test(email)) return false;
  const local = email.slice(0, email.lastIndexOf("@"));
  return !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
}
