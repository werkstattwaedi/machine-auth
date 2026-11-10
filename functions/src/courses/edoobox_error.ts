// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/** edoobox answered with an error, or isn't configured (#842). */
export class EdooboxError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = "EdooboxError";
  }
}
