// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Gruppen — the sync report of the Workspace groups behind
// Freiwilligengruppe / Interne Nutzung (ADR-0053). Opening the page runs the
// sync (ADM-11), so what it shows is what Workspace says right now: who is
// in each group (ADM-12: changed in Workspace only), the addresses that match
// no account (ADM-13) and volunteers without a membership (ADM-14).

import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { formatDateTime } from "@modules/lib/format"
import { USAGE_TYPE_LABELS, type UsageGroup } from "@oww/shared"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@modules/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import { Loader2, RefreshCw } from "lucide-react"

export const Route = createFileRoute("/_authenticated/users/groups")({
  component: GroupsPage,
})

/** The `syncUsageGroups` callable's report (functions/src/usage_groups). */
interface UsageGroupSyncReport {
  syncedAt: string
  groups: {
    group: UsageGroup
    groupEmail: string | null
    members: number
    unmatched: string[]
  }[]
  changed: number
  accounts: {
    userId: string
    name: string
    email: string
    groups: UsageGroup[]
    member: boolean
  }[]
}

function syncCallable(functions: ReturnType<typeof useFunctions>) {
  return rpcCallable<Record<string, never>, UsageGroupSyncReport>(
    functions,
    "authCall",
    "syncUsageGroups",
  )
}

function GroupsPage() {
  const functions = useFunctions()
  const [report, setReport] = useState<UsageGroupSyncReport | null>(null)
  const [firstRunFailed, setFirstRunFailed] = useState(false)
  const sync = useAsyncMutation<UsageGroupSyncReport>({
    context: "admin.syncUsageGroups",
    errorMessage: "Gruppen konnten nicht synchronisiert werden",
  })

  // Opening the page runs the sync once; failing, it says so in place.
  useEffect(() => {
    let live = true
    syncCallable(functions)({})
      .then((r) => live && setReport(r.data))
      .catch(() => live && setFirstRunFailed(true))
    return () => {
      live = false
    }
  }, [functions])

  // The hook owns the toast; a failed re-run keeps the last report.
  const rerun = () =>
    sync
      .mutate(async () => (await syncCallable(functions)({})).data)
      .then(setReport)
      .catch(() => {})

  const refresh = (
    <Button variant="secondary" onClick={rerun} disabled={sync.loading}>
      {sync.loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 h-4 w-4" />
      )}
      Jetzt synchronisieren
    </Button>
  )

  if (!report) {
    return (
      <div className="space-y-4">
        <PageHeader title="Gruppen" backTo="/users" backLabel="Zurück zu Personen" action={refresh} />
        {firstRunFailed ? (
          <p className="text-sm text-muted-foreground">
            Google Workspace konnte nicht abgefragt werden.
          </p>
        ) : (
          <PageLoading />
        )}
      </div>
    )
  }

  const withoutMembership = report.accounts.filter(
    (a) => a.groups.includes("volunteering") && !a.member,
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Gruppen" backTo="/users" backLabel="Zurück zu Personen" action={refresh} />
      <p className="text-sm text-muted-foreground">
        Mitglieder werden in Google Workspace verwaltet und stündlich übernommen. Zuletzt
        synchronisiert: {formatDateTime(new Date(report.syncedAt))}
        {report.changed > 0 ? ` · ${report.changed} Konten geändert` : ""}.
      </p>

      {withoutMembership.length > 0 && (
        <div
          data-testid="volunteers-without-membership"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {withoutMembership.length === 1
            ? "1 Person in der Freiwilligengruppe hat keine aktive Mitgliedschaft."
            : `${withoutMembership.length} Personen in der Freiwilligengruppe haben keine aktive Mitgliedschaft.`}
        </div>
      )}

      {report.groups.map((g) => {
        const accounts = report.accounts.filter((a) => a.groups.includes(g.group))
        return (
          <Card key={g.group}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-baseline gap-2">
                {USAGE_TYPE_LABELS[g.group]}
                <span className="text-sm font-normal text-muted-foreground">
                  {g.groupEmail ?? "nicht eingerichtet"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {g.groupEmail === null ? (
                <p className="text-sm text-muted-foreground">
                  Für diese Gruppe ist keine Workspace-Adresse konfiguriert; sie wird nicht
                  synchronisiert.
                </p>
              ) : accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Konten in dieser Gruppe.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>E-Mail</TableHead>
                      <TableHead>Mitgliedschaft</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((a) => (
                      <TableRow key={a.userId}>
                        <TableCell>
                          <Link
                            to="/users/$userId"
                            params={{ userId: a.userId }}
                            className="font-medium hover:underline"
                          >
                            {a.name || "Ohne Namen"}
                          </Link>
                        </TableCell>
                        <TableCell>{a.email}</TableCell>
                        <TableCell>
                          {a.member ? (
                            <Badge variant="secondary">aktiv</Badge>
                          ) : g.group === "volunteering" ? (
                            <Badge variant="gold">keine Mitgliedschaft</Badge>
                          ) : (
                            <Badge variant="outline">keine</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {g.unmatched.length > 0 && (
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">Adressen ohne Konto ({g.unmatched.length})</div>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {g.unmatched.map((email) => (
                      <li key={email}>{email}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
