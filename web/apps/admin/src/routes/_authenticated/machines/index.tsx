// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { PageLoading } from "@modules/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { BadgeList } from "@/components/admin/badge-list"
import { Button } from "@modules/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { type ColumnDef } from "@tanstack/react-table"
import { Plus, Loader2 } from "lucide-react"
import { useMemo, useState } from "react"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useForm } from "react-hook-form"
import {
  macoRef,
  machineRef,
  machinesCollection,
} from "@modules/lib/firestore-helpers"
import type { MachineDoc } from "@modules/lib/firestore-entities"
import { useDb } from "@modules/lib/firebase-context"

export const Route = createFileRoute("/_authenticated/machines/")({
  component: MachinesPage,
})

function MachinesPage() {
  const db = useDb()
  const { data, loading } = useCollection(machinesCollection(db))
  const { permissions, terminals } = useLookup()
  const [createOpen, setCreateOpen] = useState(false)

  const columns = useMemo<ColumnDef<MachineDoc & { id: string }>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <ColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Link
            to="/machines/$machineId"
            params={{ machineId: row.original.id }}
            className="font-medium hover:underline"
          >
            {row.getValue("name")}
          </Link>
        ),
      },
      {
        accessorKey: "requiredPermission",
        header: "Berechtigungen",
        cell: ({ row }) => {
          const perms = (row.original.requiredPermission ?? []).map((p) =>
            resolveRef(permissions, p)
          )
          return <BadgeList items={perms} variant="outline" />
        },
        enableSorting: false,
      },
      {
        accessorKey: "maco",
        header: "Terminal",
        cell: ({ row }) => resolveRef(terminals, row.original.maco),
        enableSorting: false,
      },
    ],
    [permissions, terminals]
  )

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader
        title="Maschinen"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Maschine erstellen
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Maschine suchen..."
      />
      <CreateMachineDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function CreateMachineDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const db = useDb()
  const { set, loading } = useFirestoreMutation()
  const { register, handleSubmit, reset } = useForm<{ id: string; name: string; macoId: string }>()

  const onSubmit = async (values: { id: string; name: string; macoId: string }) => {
    await set(
      machineRef(db, values.id),
      {
        name: values.name,
        requiredPermission: [],
        maco: values.macoId ? macoRef(db, values.macoId) : null,
      },
      {
        successMessage: "Maschine erstellt",
      },
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
            <Input id="machine-id" placeholder="z.B. laser-01" {...register("id", { required: true })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="machine-name">Name</Label>
            <Input id="machine-name" placeholder="z.B. Laser Cutter" {...register("name", { required: true })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="machine-maco">Terminal (MaCo Device ID)</Label>
            <Input id="machine-maco" placeholder="Optional" {...register("macoId")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Erstellen
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
