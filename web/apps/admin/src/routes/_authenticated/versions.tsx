// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Versionen (ADR-0045 phase 3): which release each part of this project
// runs right now — the cloud (functions, both web apps) and every device
// that reports its status (gateway, terminals, kiosk). The deploy history
// lives in the operations repo's STATE.md; this page is the live view.

import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { deviceStatusGroup, macosCollection } from "@modules/lib/firestore-helpers"
import { rpcCallable } from "@modules/lib/rpc"
import { BUILD_VERSION } from "@modules/lib/build-version"
import { formatDateTime, formatRelativeTime } from "@modules/lib/format"
import { versionStanding, type VersionStanding } from "@oww/shared"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { EmptyState } from "@modules/components/empty-state"
import { Badge } from "@modules/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@modules/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import { Cpu } from "lucide-react"
import {
  deviceRows,
  isQuiet,
  RESET_REASON_LABEL,
  STANDING_LABEL,
  targetRelease,
} from "@/lib/versions"

export const Route = createFileRoute("/_authenticated/versions")({
  component: VersionsPage,
})

/** null while loading, undefined when it couldn't be read. */
type Loaded = string | null | undefined

function useFunctionsVersion(): Loaded {
  const functions = useFunctions()
  const [version, setVersion] = useState<Loaded>(null)
  useEffect(() => {
    let live = true
    rpcCallable<Record<string, never>, { version?: string }>(functions, "authCall", "ping")({})
      .then((r) => live && setVersion(r.data.version ?? undefined))
      .catch(() => live && setVersion(undefined))
    return () => {
      live = false
    }
  }, [functions])
  return version
}

function useCheckoutVersion(): Loaded {
  const [version, setVersion] = useState<Loaded>(null)
  useEffect(() => {
    const domain = import.meta.env.VITE_CHECKOUT_DOMAIN
    if (!domain || domain.startsWith("localhost")) {
      setVersion(undefined)
      return
    }
    let live = true
    // Served next to the checkout app by its build (scripts/deploy/build-version.ts),
    // with a CORS header for this page (firebase.json).
    fetch(`https://${domain}/version.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { version?: unknown }) =>
        live && setVersion(typeof j.version === "string" ? j.version : undefined),
      )
      .catch(() => live && setVersion(undefined))
    return () => {
      live = false
    }
  }, [])
  return version
}

const STANDING_VARIANT: Record<VersionStanding, "success" | "destructive" | "secondary" | "outline"> = {
  current: "success",
  behind: "destructive",
  dev: "secondary",
  unknown: "outline",
}

function VersionCell({ version, target }: { version: Loaded; target: string | null }) {
  if (version === null) return <span className="text-muted-foreground">…</span>
  if (version === undefined) return <span className="text-muted-foreground">nicht lesbar</span>
  const standing = versionStanding(version, target)
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="text-xs">{version}</code>
      <Badge variant={STANDING_VARIANT[standing]}>{STANDING_LABEL[standing]}</Badge>
    </span>
  )
}

function VersionsPage() {
  const db = useDb()
  const functionsVersion = useFunctionsVersion()
  const checkoutVersion = useCheckoutVersion()
  const { data: statuses, loading, error } = useCollection(deviceStatusGroup(db))
  const { data: macos } = useCollection(macosCollection(db))

  const macoNames = useMemo(() => new Map(macos.map((m) => [m.id, m.name])), [macos])
  const cloud: Array<{ label: string; version: Loaded }> = [
    { label: "Cloud Functions", version: functionsVersion },
    { label: "Admin-App", version: BUILD_VERSION === "dev" ? undefined : BUILD_VERSION },
    { label: "Checkout-App", version: checkoutVersion },
  ]
  const target = targetRelease(
    cloud.map((c) => c.version),
    statuses,
  )
  const rows = deviceRows(statuses, macoNames, target)
  const now = Date.now()

  return (
    <div className="space-y-4">
      <PageHeader title="Versionen" />
      <p className="text-sm text-muted-foreground">
        {target ? (
          <>
            Neuste Version: <code>{target}</code>. Verlauf der Deployments: <code>STATE.md</code> im
            Operations-Repo.
          </>
        ) : (
          "Noch keine Release-Version im Einsatz."
        )}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Cloud</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {cloud.map((c) => (
                <TableRow key={c.label}>
                  <TableCell className="w-48 font-medium">{c.label}</TableCell>
                  <TableCell>
                    <VersionCell version={c.version} target={target} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Geräte</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PageLoading />
          ) : error ? (
            <p className="text-sm text-destructive" role="alert">
              Gerätestatus konnte nicht geladen werden: {error.message}
            </p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Cpu}
              title="Noch keine Geräte gemeldet"
              description="Gateway und Kiosk melden sich, sobald sie mit einer Version ab ADR-0045 laufen."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gerät</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead title="Stündlich aktualisiert, der Kiosk täglich">
                    Zuletzt gehört
                  </TableHead>
                  <TableHead>Letzter Neustart</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.kindLabel}
                        {r.name !== r.deviceId ? ` · ${r.deviceId}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <VersionCell version={r.status.version ?? undefined} target={target} />
                    </TableCell>
                    <TableCell>
                      {!r.status.online ? (
                        <Badge variant="destructive">
                          offline · {formatRelativeTime(r.status.since)}
                        </Badge>
                      ) : isQuiet(r.status, now) ? (
                        // A dead gateway can't report itself offline; its
                        // reports just stop.
                        <Badge variant="destructive">keine Meldung</Badge>
                      ) : r.kind === "kiosks" ? (
                        <Badge variant="success">gemeldet</Badge>
                      ) : (
                        <Badge variant="success">online</Badge>
                      )}
                    </TableCell>
                    <TableCell title={formatDateTime(r.status.lastSeen)}>
                      {formatRelativeTime(r.status.lastSeen)}
                    </TableCell>
                    <TableCell>
                      {r.status.bootedAt ? (
                        <span title={formatDateTime(r.status.bootedAt)}>
                          {formatRelativeTime(r.status.bootedAt)}
                          {r.status.resetReason
                            ? ` (${RESET_REASON_LABEL[r.status.resetReason] ?? r.status.resetReason})`
                            : ""}
                        </span>
                      ) : (
                        "–"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
