// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Machine workspace — status + Sperren/Freigeben up top, then tabs:
// Übersicht (what admins act on), Meldungen (user reports + triage) and
// Einstellungen (name/terminal/required permissions). Usage history is a
// deep link into the shared Nutzungen ledger, pre-filtered.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useState, type ReactNode } from "react"
import { where, serverTimestamp } from "firebase/firestore"
import { useDocument, useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import {
  machineRef,
  machineReportRef,
  machineReportsCollection,
  macoRef,
  macosCollection,
  permissionRef,
  permissionsCollection,
  usageMachineCollection,
  usersCollection,
} from "@modules/lib/firestore-helpers"
import type {
  MachineDoc,
  MachineReportDoc,
} from "@modules/lib/firestore-entities"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { useForm } from "react-hook-form"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import {
  MachineStatusBadge,
  MachineStatusDot,
} from "@/components/machine/machine-status-badge"
import { BlockMachineDialog } from "@/components/machine/block-machine-dialog"
import { machineStatus } from "@/lib/machine-status"
import { formatDate, formatDateTime } from "@modules/lib/format"
import { formatDuration } from "@/lib/duration"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent } from "@modules/components/ui/card"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@modules/components/ui/tabs"
import { EmptyState } from "@modules/components/empty-state"
import {
  Check,
  Loader2,
  Lock,
  LockOpen,
  MessageSquareWarning,
  MoveRight,
  Save,
} from "lucide-react"

const TABS = ["overview", "reports", "settings"] as const
type MachineTab = (typeof TABS)[number]

interface MachineSearch {
  tab?: Exclude<MachineTab, "overview">
}

export const Route = createFileRoute("/_authenticated/machines/$machineId")({
  validateSearch: (search: Record<string, unknown>): MachineSearch => ({
    tab:
      search.tab === "reports" || search.tab === "settings"
        ? search.tab
        : undefined,
  }),
  component: MachineDetailPage,
})

function MachineDetailPage() {
  const db = useDb()
  const navigate = useNavigate()
  const { machineId } = Route.useParams()
  const { tab } = Route.useSearch()
  const { data: machine, loading } = useDocument(machineRef(db, machineId))
  const { data: reports } = useCollection(
    machineReportsCollection(db),
    where("machine", "==", machineRef(db, machineId)),
  )
  const { update } = useFirestoreMutation()
  const [blockOpen, setBlockOpen] = useState(false)
  const [editReason, setEditReason] = useState(false)

  if (loading) return <PageLoading />
  if (!machine) return <div>Maschine nicht gefunden.</div>

  const status = machineStatus(machine)
  const openReports = reports.filter((r) => r.status === "open")
  const activeTab: MachineTab = tab ?? "overview"

  const handleUnblock = () =>
    update(
      machineRef(db, machineId),
      { blocked: null },
      { successMessage: `${machine.name} freigegeben` },
    )

  return (
    <div key={machineId} className="space-y-4">
      <PageHeader
        title={machine.name || machineId}
        backTo="/machines"
        backLabel="Zurück zu Maschinen"
        action={
          status === "free" ? (
            <Button variant="outline" className="text-destructive" onClick={() => setBlockOpen(true)}>
              <Lock className="mr-2 h-4 w-4" />
              Sperren
            </Button>
          ) : (
            <Button variant="outline" onClick={handleUnblock}>
              <LockOpen className="mr-2 h-4 w-4" />
              Freigeben
            </Button>
          )
        }
      />

      <div className="-mt-4 flex items-center gap-2">
        <MachineStatusDot status={status} />
        <MachineStatusBadge status={status} />
        {machine.workshop && (
          <span className="text-sm text-muted-foreground">{machine.workshop}</span>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          navigate({
            to: "/machines/$machineId",
            params: { machineId },
            search: {
              tab: value === "overview" ? undefined : (value as MachineSearch["tab"]),
            },
          })
        }
      >
        <TabsList>
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="reports">
            Meldungen
            {openReports.length > 0 && (
              <Badge className="ml-1.5 bg-oww-gold-light text-oww-gold-text border-oww-gold-border">
                {openReports.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="settings">Einstellungen</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <MachineOverview
            machineId={machineId}
            machine={machine}
            openReportCount={openReports.length}
            onEditReason={() => setEditReason(true)}
            onUnblock={handleUnblock}
          />
        </TabsContent>
        <TabsContent value="reports">
          <MachineReports machineId={machineId} reports={reports} />
        </TabsContent>
        <TabsContent value="settings">
          <MachineSettings machineId={machineId} machine={machine} />
        </TabsContent>
      </Tabs>

      <BlockMachineDialog
        open={blockOpen || editReason}
        onOpenChange={(open) => {
          if (!open) {
            setBlockOpen(false)
            setEditReason(false)
          }
        }}
        machineId={machineId}
        machineName={machine.name || machineId}
        existing={editReason ? (machine.blocked ?? null) : null}
      />
    </div>
  )
}

function MachineOverview({
  machineId,
  machine,
  openReportCount,
  onEditReason,
  onUnblock,
}: {
  machineId: string
  machine: MachineDoc
  openReportCount: number
  onEditReason: () => void
  onUnblock: () => void
}) {
  const db = useDb()
  const { users: userNames } = useLookup()
  const { data: usages } = useCollection(
    usageMachineCollection(db),
    where("machine", "==", machineRef(db, machineId)),
  )
  const { data: allUsers } = useCollection(usersCollection(db))

  const lastUsage = [...usages].sort(
    (a, b) => (b.startTime?.toMillis() ?? 0) - (a.startTime?.toMillis() ?? 0),
  )[0]

  // "Berechtigt" = people holding every required permission.
  const requiredIds = (machine.requiredPermission ?? []).map((p) => p.id)
  const authorizedCount =
    requiredIds.length === 0
      ? null
      : allUsers.filter((u) => {
          const held = new Set((u.permissions ?? []).map((p) => p.id))
          return requiredIds.every((id) => held.has(id))
        }).length

  return (
    <div className="space-y-4 pt-2">
      {machine.blocked && (
        <div className="space-y-2 rounded-xl border border-destructive/40 border-l-4 border-l-destructive bg-destructive/5 px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-semibold">
              Gesperrt — {machine.blocked.kind === "maintenance" ? "Wartung" : "Problem"}
            </span>
            <span className="text-muted-foreground">
              seit {formatDate(machine.blocked.at)}
              {machine.blocked.byName ? ` · durch ${machine.blocked.byName}` : ""}
            </span>
          </div>
          {machine.blocked.note && (
            <p className="text-sm text-muted-foreground">
              „{machine.blocked.note}“
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={onUnblock}>
              <LockOpen className="mr-2 h-4 w-4" />
              Freigeben
            </Button>
            <Button size="sm" variant="outline" onClick={onEditReason}>
              Grund bearbeiten
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <OverviewCard
          label="Offene Meldungen"
          value={String(openReportCount)}
          accent={openReportCount > 0 ? "border-l-4 border-l-oww-gold-dark" : undefined}
          link={
            <Link
              to="/machines/$machineId"
              params={{ machineId }}
              search={{ tab: "reports" }}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Meldungen
              <MoveRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <OverviewCard
          label="Letzte Nutzung"
          value={lastUsage ? formatDate(lastUsage.startTime) : "–"}
          hint={
            lastUsage
              ? `${resolveRef(userNames, lastUsage.userId)} · ${formatDuration(lastUsage.startTime, lastUsage.endTime)}`
              : undefined
          }
          link={
            <Link
              to="/usages"
              search={{ machine: machineId }}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Nutzungen
              <MoveRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <OverviewCard
          label="Berechtigt"
          value={authorizedCount == null ? "alle" : `${authorizedCount} Pers.`}
          hint={
            requiredIds.length === 0
              ? "keine Berechtigung erforderlich"
              : undefined
          }
          link={
            <Link
              to="/machines/$machineId"
              params={{ machineId }}
              search={{ tab: "settings" }}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Einstellungen
              <MoveRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
      </div>
    </div>
  )
}

function OverviewCard({
  label,
  value,
  hint,
  accent,
  link,
}: {
  label: string
  value: string
  hint?: string
  accent?: string
  link: ReactNode
}) {
  return (
    <div
      className={`flex min-h-24 flex-col gap-1 rounded-xl border bg-card p-4 shadow-sm ${accent ?? ""}`}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-heading text-lg font-bold">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <span className="mt-auto self-end text-sm">{link}</span>
    </div>
  )
}

function MachineReports({
  machineId,
  reports,
}: {
  machineId: string
  reports: (MachineReportDoc & { id: string })[]
}) {
  const db = useDb()
  const { users } = useLookup()
  const { update, loading } = useFirestoreMutation()

  const sorted = [...reports].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1
    return (b.created?.toMillis() ?? 0) - (a.created?.toMillis() ?? 0)
  })

  const markDone = (reportId: string) =>
    update(
      machineReportRef(db, reportId),
      { status: "done", resolvedAt: serverTimestamp() as unknown as null },
      { successMessage: "Meldung erledigt" },
    )

  if (sorted.length === 0) {
    return (
      <div className="pt-2">
        <EmptyState
          icon={MessageSquareWarning}
          title="Keine Meldungen"
          description={`Für diese Maschine wurden keine Probleme gemeldet (Maschine: ${machineId}).`}
        />
      </div>
    )
  }

  return (
    <Card className="mt-2 px-4 py-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Meldung</TableHead>
            <TableHead>Von / Datum</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((report) => (
            <TableRow key={report.id}>
              <TableCell className="max-w-md whitespace-normal">
                {report.message}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {report.userId
                  ? resolveRef(users, report.userId)
                  : (report.reporterName ?? "anonym")}{" "}
                · {formatDateTime(report.created)}
              </TableCell>
              <TableCell>
                {report.status === "open" ? (
                  <Badge className="bg-oww-gold-light text-oww-gold-text border-oww-gold-border">
                    offen
                  </Badge>
                ) : (
                  <Badge variant="secondary">erledigt</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                {report.status === "open" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markDone(report.id)}
                    disabled={loading}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Erledigt
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

function MachineSettings({
  machineId,
  machine,
}: {
  machineId: string
  machine: MachineDoc
}) {
  const db = useDb()
  const { data: allPermissions } = useCollection(permissionsCollection(db))
  const { data: allMacos } = useCollection(macosCollection(db))
  const { update, loading: saving } = useFirestoreMutation()
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const { register, handleSubmit, reset } = useForm<{
    name: string
    macoId: string
  }>()

  useEffect(() => {
    setSelectedPermissions(
      (machine.requiredPermission ?? []).map((p) =>
        typeof p === "string" ? p : p.id,
      ),
    )
    reset({
      name: machine.name,
      macoId: machine.maco ? machine.maco.id : "",
    })
  }, [machine, reset])

  const onSubmit = async (values: { name: string; macoId: string }) => {
    await update(
      machineRef(db, machineId),
      {
        name: values.name,
        requiredPermission: selectedPermissions.map((id) => permissionRef(db, id)),
        maco: values.macoId ? macoRef(db, values.macoId) : null,
      },
      { successMessage: "Maschine gespeichert" },
    )
  }

  const togglePermission = (permId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId],
    )
  }

  return (
    <Card className="mt-2 max-w-xl">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>ID</Label>
            <Input value={machineId} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="machine-name">Name</Label>
            <Input id="machine-name" {...register("name")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="machine-maco">Terminal</Label>
            <select
              id="machine-maco"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              {...register("macoId")}
            >
              <option value="">– Kein Terminal –</option>
              {allMacos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>Erforderliche Berechtigungen</Label>
            <div className="flex flex-wrap gap-2">
              {allPermissions.map((perm) => (
                <Badge
                  key={perm.id}
                  variant={selectedPermissions.includes(perm.id) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => togglePermission(perm.id)}
                >
                  {perm.name || perm.id}
                </Badge>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Speichern
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
