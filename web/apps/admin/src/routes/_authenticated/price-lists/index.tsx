// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { PageLoading } from "@modules/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@modules/components/ui/badge"
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
import { useState } from "react"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useForm } from "react-hook-form"
import type { PriceList } from "@modules/lib/workshop-config"

export const Route = createFileRoute("/_authenticated/price-lists/")({
  component: PriceListsPage,
})

const columns: ColumnDef<PriceList>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <ColumnHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <Link
        to="/price-lists/$priceListId"
        params={{ priceListId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.getValue("name")}
      </Link>
    ),
  },
  {
    accessorKey: "footer",
    header: "Fusszeile",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.footer || "–"}</span>
    ),
  },
  {
    accessorKey: "items",
    header: "Einträge",
    cell: ({ row }) => row.original.items?.length ?? 0,
  },
  {
    accessorKey: "active",
    header: "Status",
    cell: ({ row }) =>
      row.original.active ? (
        <Badge variant="secondary">Aktiv</Badge>
      ) : (
        <Badge variant="outline">Inaktiv</Badge>
      ),
  },
]

function PriceListsPage() {
  const { data, loading } = useCollection<PriceList>("price_lists")
  const [createOpen, setCreateOpen] = useState(false)

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader
        title="Preislisten"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Erstellen
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Preislisten durchsuchen..."
      />
      <CreatePriceListDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

interface CreateFormValues {
  name: string
  footer: string
}

function CreatePriceListDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { add, loading } = useFirestoreMutation()
  const { register, handleSubmit, reset } = useForm<CreateFormValues>({
    defaultValues: { name: "", footer: "" },
  })

  const onSubmit = async (values: CreateFormValues) => {
    try {
      await add("price_lists", {
        name: values.name,
        footer: values.footer,
        items: [],
        active: true,
      }, {
        successMessage: "Preisliste erstellt",
      })
      reset()
      onOpenChange(false)
    } catch {
      // useFirestoreMutation already shows error toast
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Preisliste erstellen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input {...register("name", { required: true })} placeholder="z.B. Holzwerkstatt Materialien" />
          </div>
          <div className="space-y-1">
            <Label>Fusszeile</Label>
            <Input {...register("footer")} placeholder="z.B. Offene Werkstatt Wädenswil" />
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
