// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Web NFC tag scanning for admins (Chrome on Android only).
 *
 * Reads a tag's SUN URL (`…?picc=…&cmac=…`) via `NDEFReader`, then asks the
 * `resolveTag` callable to decrypt + authenticate it server-side and report
 * whether it's registered. The tags use Random-ID, so the real UID / tokenId
 * only exists after server-side PICC decryption — see `auth/resolve-tag.ts`.
 *
 * Web NFC needs a secure context (HTTPS / localhost) and a user gesture to
 * start the scan; it is unavailable in any non-Android-Chrome browser, where
 * `supported` is false and admins fall back to manual UID entry.
 */

import { useCallback } from "react"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"

export interface ResolveTagResult {
  tokenId: string
  registered: boolean
  deactivated: boolean
  userId?: string
  userName?: string
}

/** True when the running browser exposes Web NFC. */
export function isNfcSupported(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window
}

/**
 * Extract the SUN `picc`/`cmac` params from a tapped tag's URL.
 * Accepts the value case-insensitively. Throws a German error if the URL is
 * not an OWW SUN URL (missing either parameter).
 */
export function parseSunUrl(raw: string): { picc: string; cmac: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("Kein OWW-Tag erkannt.")
  }
  const params = url.searchParams
  // SDM param names are lowercase in production, but be lenient.
  const picc = params.get("picc") ?? params.get("PICC")
  const cmac = params.get("cmac") ?? params.get("CMAC")
  if (!picc || !cmac) {
    throw new Error("Kein OWW-Tag erkannt.")
  }
  return { picc, cmac }
}

/** Non-throwing variant for scanning multiple records. */
function tryParseSunUrl(raw: string): { picc: string; cmac: string } | null {
  try {
    return parseSunUrl(raw)
  } catch {
    return null
  }
}

/** Time to wait for a tap before giving up. */
const SCAN_TIMEOUT_MS = 30_000

/**
 * Start a single Web NFC scan and resolve the SUN params from the first tag
 * read. Rejects with a German message on permission denial, timeout, or a
 * non-OWW tag. The caller is responsible for invoking this from a user gesture.
 */
export function scanTagUrl(): Promise<{ picc: string; cmac: string }> {
  if (!isNfcSupported()) {
    return Promise.reject(
      new Error("Tag-Scan ist nur in Chrome auf Android verfügbar."),
    )
  }

  const reader = new NDEFReader()
  const controller = new AbortController()

  return new Promise<{ picc: string; cmac: string }>((resolve, reject) => {
    let settled = false
    const finish = (err: Error | null, value?: { picc: string; cmac: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      controller.abort() // stop the scan + release the listeners
      if (err) reject(err)
      else resolve(value!)
    }

    const timer = setTimeout(
      () => finish(new Error("Kein Tag erkannt (Zeitüberschreitung).")),
      SCAN_TIMEOUT_MS,
    )

    reader.addEventListener("reading", (event) => {
      try {
        // Record types that can carry a URL. Decoding a binary record
        // (smart poster, raw MIME, …) as UTF-8 risks a spurious match.
        const URL_TYPES = ["url", "absolute-url", "text"]
        const seen: string[] = []
        for (const record of event.message.records) {
          seen.push(record.recordType)
          if (!URL_TYPES.includes(record.recordType)) continue
          if (!record.data) continue
          // `encoding` is only meaningful for text records; url records are
          // always UTF-8.
          const encoding =
            record.recordType === "text"
              ? record.encoding || "utf-8"
              : "utf-8"
          const text = new TextDecoder(encoding).decode(record.data)
          const sun = tryParseSunUrl(text)
          if (sun) {
            finish(null, sun)
            return
          }
        }
        // Include the NDEF record types we actually saw — on a phone with no
        // dev console this is the only window into why a tap was rejected.
        finish(
          new Error(
            `Kein OWW-Tag erkannt (NDEF: ${seen.join(", ") || "leer"}).`,
          ),
        )
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)))
      }
    })

    reader.addEventListener("readingerror", () => {
      finish(new Error("NDEF-Lesefehler – Tag erneut auflegen."))
    })

    reader.scan({ signal: controller.signal }).catch((err: unknown) => {
      // Most commonly NotAllowedError (permission) or NotSupportedError.
      const name = (err as { name?: string })?.name
      if (name === "NotAllowedError") {
        finish(new Error("NFC-Zugriff verweigert."))
      } else {
        finish(new Error("Tag-Scan konnte nicht gestartet werden."))
      }
    })
  })
}

/**
 * Hook exposing NFC availability and a `scanTag()` that reads a tag and
 * resolves it via the backend. Wrap `scanTag` in `useAsyncMutation` at the
 * call site (ADR-0025 owns the toast); this hook only does the raw work.
 */
export function useTagScan() {
  const functions = useFunctions()
  const supported = isNfcSupported()

  const scanTag = useCallback(async (): Promise<ResolveTagResult> => {
    const { picc, cmac } = await scanTagUrl()
    const resolve = rpcCallable<
      { picc: string; cmac: string },
      ResolveTagResult
    >(functions, "authCall", "resolveTag")
    const { data } = await resolve({ picc, cmac })
    return data
  }, [functions])

  return { supported, scanTag }
}
