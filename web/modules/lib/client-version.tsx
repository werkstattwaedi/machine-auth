// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Keeps open web apps on a current build (#845).
 *
 * - A newer deploy (`/version.json`, served no-cache, differs from the
 *   compiled `BUILD_VERSION`) → a lasting toast with «Neu laden». The kiosk
 *   gets none: it reloads the checkout after every session anyway.
 * - Older than `config/clients.minVersion`, or refused as outdated by a
 *   dispatcher (`client-outdated.ts`) → a blocking screen. It reloads by
 *   itself once the new build is being served, at most once per version
 *   (sessionStorage), so a CDN still serving the old build can't loop.
 *
 * Local and e2e builds report "dev": no polling, no Firestore listener, never
 * blocked — so this never shows up in screenshot baselines.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { isBelowMinVersion } from "@oww/shared"
import { Button } from "../components/ui/button"
import { BUILD_VERSION } from "./build-version"
import {
  isClientReportedOutdated,
  subscribeClientOutdated,
} from "./client-outdated"
import { useDb } from "./firebase-context"
import { useDocument } from "./firestore"
import { clientsConfigRef } from "./firestore-helpers"
import { useBridge } from "./use-bridge"

const POLL_MS = 15 * 60_000
const RELOAD_KEY = "oww.clientVersionReload"
const UPDATE_TOAST_ID = "client-version-update"

export type ClientVersionState = "ok" | "update-available" | "outdated"

export function clientVersionState(input: {
  build: string
  minVersion: string | null | undefined
  deployed: string | null
  serverOutdated: boolean
}): ClientVersionState {
  if (input.serverOutdated || isBelowMinVersion(input.build, input.minVersion)) {
    return "outdated"
  }
  if (input.build !== "dev" && input.deployed && input.deployed !== input.build) {
    return "update-available"
  }
  return "ok"
}

/**
 * Whether an outdated app may reload by itself now: the deployed build must
 * be new enough (else the reload brings back the same old app), and this tab
 * must not have reloaded for that build already.
 */
export function shouldAutoReload(input: {
  build: string
  deployed: string | null
  minVersion: string | null | undefined
  lastReloadFor: string | null
}): boolean {
  const { build, deployed, minVersion, lastReloadFor } = input
  if (!deployed || deployed === build || deployed === lastReloadFor) return false
  return !isBelowMinVersion(deployed, minVersion)
}

export async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch("/version.json", { cache: "no-store" })
    if (!res.ok) return null
    const body = (await res.json()) as { version?: unknown }
    return typeof body.version === "string" && body.version ? body.version : null
  } catch {
    return null
  }
}

function readLastReload(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_KEY)
  } catch {
    return null
  }
}

function writeLastReload(version: string): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, version)
  } catch {
    // Storage blocked: the deployed-version check alone still prevents a
    // reload into the same old build.
  }
}

/** Mounted once per app, inside `FirebaseProvider`. */
export function ClientVersionGate() {
  const db = useDb()
  const { available: kiosk } = useBridge()
  const isDev = BUILD_VERSION === "dev"
  const { data } = useDocument(isDev ? null : clientsConfigRef(db))
  return (
    <ClientVersionGateView
      build={BUILD_VERSION}
      minVersion={data?.minVersion ?? null}
      kiosk={kiosk}
    />
  )
}

export function ClientVersionGateView({
  build,
  minVersion,
  kiosk,
  fetchDeployed = fetchDeployedVersion,
  reload = () => window.location.reload(),
}: {
  build: string
  minVersion: string | null
  kiosk: boolean
  fetchDeployed?: () => Promise<string | null>
  reload?: () => void
}) {
  const [deployed, setDeployed] = useState<string | null>(null)
  const serverOutdated = useSyncExternalStore(
    subscribeClientOutdated,
    isClientReportedOutdated,
  )
  const state = clientVersionState({ build, minVersion, deployed, serverOutdated })

  const check = useCallback(async () => {
    const v = await fetchDeployed()
    if (v) setDeployed(v)
    return v
  }, [fetchDeployed])

  // Poll the deployed version: on start, when the tab is shown again, and
  // every 15 minutes. A local build has no version.json to ask.
  useEffect(() => {
    if (build === "dev") return
    void check()
    const onVisible = () => {
      if (document.visibilityState === "visible") void check()
    }
    document.addEventListener("visibilitychange", onVisible)
    const timer = window.setInterval(() => void check(), POLL_MS)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.clearInterval(timer)
    }
  }, [build, check])

  // Outdated: ask again right away (the deploy may be minutes old) and
  // reload once the new build is there.
  useEffect(() => {
    if (state !== "outdated") return
    let cancelled = false
    void check().then((v) => {
      if (cancelled) return
      if (shouldAutoReload({ build, deployed: v, minVersion, lastReloadFor: readLastReload() })) {
        writeLastReload(v!)
        reload()
      }
    })
    return () => {
      cancelled = true
    }
  }, [state, build, minVersion, check, reload])

  useEffect(() => {
    if (state !== "update-available" || kiosk) return
    toast("Eine neue Version ist verfügbar.", {
      id: UPDATE_TOAST_ID,
      duration: Infinity,
      action: { label: "Neu laden", onClick: () => reload() },
    })
  }, [state, kiosk, reload])

  if (state !== "outdated") return null
  return <OutdatedScreen onReload={reload} />
}

export function OutdatedScreen({ onReload }: { onReload: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="client-outdated-title"
      aria-describedby="client-outdated-text"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-background p-4"
    >
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 id="client-outdated-title" className="font-heading text-2xl">
          Die App wurde aktualisiert
        </h1>
        <p id="client-outdated-text" className="text-muted-foreground">
          Bitte lade die Seite neu, um weiterzumachen.
        </p>
        <Button size="lg" onClick={onReload}>
          Neu laden
        </Button>
      </div>
    </div>
  )
}
