// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Maschinen — entry point into a machine's workspace. Status dot (frei /
// gesperrt / Wartung), last usage, open report count; row → machine page.

import { createFileRoute, Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { where, orderBy, limit } from "firebase/firestore"
import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import {
  machinesCollection,
  machineReportsCollection,
  machineRef,
  macoRef,
  usageMachineCollection,
} from "@modules/lib/firestore-helpers"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useForm } from "react-hook-form"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { FilterPills } from "@/components/admin/filter-pills"
import {
  MachineStatusBadge,
  MachineStatusDot,
} from "@/components/machine/machine-status-badge"
import { machineStatus, type MachineStatus } from "@/lib/machine-status"
import { formatDate } from "@modules/lib/format"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card } from "@modules/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
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
import { ChevronRight, Loader2, Plus } from "lucide-react"

type MachineFilter = "all" | MachineStatus | "reports"

export const Route = createFileRoute("/_authenticated/machines/")({
  component: MachinesPage,
})

function MachinesPage() {
  const db = useDb()
  const { data: machines, loading } = useCollection(machinesCollection(db))
  const { data: openReports } = useCollection(
    machineReportsCollection(db),
    where("status", "==", "open"),
  )
  // Recent usages window → "Letzte Nutzung" per machine, client-side.
  const { data: usages } = useCollection(
    usageMachineCollection(db),
    orderBy("startTime", "desc"),
    limit(200),
  )
  const { users } = useLookup()
  const [filter, setFilter] = useState<MachineFilter>("all")
  const [createOpen, setCreateOpen] = useState(false)

  const rows = useMemo(() => {
    const reportCount = new Map<string, number>()
    for (const report of openReports) {
      const id = report.machine?.id
      if (id) reportCount.set(id, (reportCount.get(id) ?? 0) + 1)
    }
    const lastUsage = new Map<string, (typeof usages)[number]>()
    for (const usage of usages) {
      const id = usage.machine?.id
      if (id && !lastUsage.has(id)) lastUsage.set(id, usage)
    }
    return machines
      .map((machine) => ({
        ...machine,
        status: machineStatus(machine),
        openReports: reportCount.get(machine.id) ?? 0,
        lastUsage: lastUsage.get(machine.id),
      }))
      .filter((m) =>
        filter === "all"
          ? true
          : filter === "reports"
            ? m.openReports > 0
            : m.status === filter,
      )
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "de-CH"))
  }, [machines, openReports, usages, filter])

  if (loading) return <PageLoading />

  const blocked = machines.filter((m) => machineStatus(m) === "blocked").length
  const maintenance = machines.filter(
    (m) => machineStatus(m) === "maintenance",
  ).length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Maschinen"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Maschine erstellen
          </Button>
        }
      />

      <FilterPills<MachineFilter>
        options={[
          { value: "all", label: "Alle" },
          { value: "free", label: "Frei" },
          { value: "blocked", label: "Gesperrt" },
          { value: "maintenance", label: "Wartung" },
          { value: "reports", label: "Offene Meldungen" },
        ]}
        value={filter}
        onChange={setFilter}
      />

      <Card className="px-4 py-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Maschine</TableHead>
              <TableHead>Werkstatt</TableHead>
              <TableHead>Letzte Nutzung</TableHead>
              <TableHead className="text-center">Meldungen</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((machine) => (
              <TableRow key={machine.id}>
                <TableCell>
                  <MachineStatusDot status={machine.status} />
                </TableCell>
                <TableCell>
                  <Link
                    to="/machines/$machineId"
                    params={{ machineId: machine.id }}
                    className="font-medium hover:underline"
                  >
                    {machine.name || machine.id}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {machine.workshop || "–"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {machine.lastUsage
                    ? `${formatDate(machine.lastUsage.startTime)} · ${resolveRef(users, machine.lastUsage.userId)}`
                    : "–"}
                </TableCell>
                <TableCell className="text-center">
                  {machine.openReports > 0 ? (
                    <Badge className="bg-oww-gold-light text-oww-gold-text border-oww-gold-border">
                      {machine.openReports}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </TableCell>
                <TableCell>
                  <MachineStatusBadge status={machine.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    to="/machines/$machineId"
                    params={{ machineId: machine.id }}
                    aria-label={`${machine.name} öffnen`}
                  >
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="text-sm text-muted-foreground">
        {machines.length} Maschinen · {blocked} gesperrt · {maintenance} in
        Wartung
      </div>

      <CreateMachineDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function CreateMachineDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const db = useDb()
  const { set, loading } = useFirestoreMutation()
  const { register, handleSubmit, reset } = useForm<{
    id: string
    name: string
    macoId: string
  }>()

  const onSubmit = async (values: { id: string; name: string; macoId: string }) => {
    await set(
      machineRef(db, values.id),
      {
        name: values.name,
        requiredPermission: [],
        maco: values.macoId ? macoRef(db, values.macoId) : null,
      },
      { successMessage: "Maschine erstellt" },
    )
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Maschine erstellen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="machine-id">ID</Label>
            <Input
              id="machine-id"
              placeholder="z.B. laser-01"
              {...register("id", { required: true })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="machine-name">Name</Label>
            <Input
              id="machine-name"
              placeholder="z.B. Laser Cutter"
              {...register("name", { required: true })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="machine-maco">Terminal (MaCo Device ID)</Label>
            <Input id="machine-maco" placeholder="Optional" {...register("macoId")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Erstellen
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
