// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { getClientSessionId } from "@modules/lib/client-session"

interface QueryErrorProps {
  context?: string
}

/**
 * Surfaces a Firestore query failure to the user. Includes the per-tab
 * session ID so a bug report can be matched against Cloud Logging entries
 * written by the server-side logClientError callable.
 */
export function QueryError({ context }: QueryErrorProps) {
  const sessionId = getClientSessionId()

  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/50 bg-destructive/5 text-destructive p-4"
    >
      <h3 className="text-sm font-semibold">
        Beim Laden ist ein Fehler aufgetreten.
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Fehler-ID: {sessionId}
      </p>
      {context && (
        <p className="mt-1 text-xs text-muted-foreground">
          Kontext: {context}
        </p>
      )}
    </div>
  )
}
