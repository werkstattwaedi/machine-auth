// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { PageLoading } from "@/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { type ColumnDef } from "@tanstack/react-table"
import { Plus, Loader2 } from "lucide-react"
import { useState } from "react"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { useForm } from "react-hook-form"
import { formatCHF } from "@/lib/format"

export const Route = createFileRoute("/_authenticated/_admin/materials/")({
  component: CatalogPage,
})

interface CatalogDoc {
  code: string
  name: string
  workshops: string[]
  pricingModel: string
  unitPrice: { none: number; member: number; intern: number }
  active: boolean
  userCanAdd: boolean
  description?: string | null
}

const columns: ColumnDef<CatalogDoc & { id: string }>[] = [
  {
    accessorKey: "code",
    header: ({ column }) => <ColumnHeader column={column} title="Code" />,
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "name",
    header: ({ column }) => <ColumnHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <Link
        to="/materials/$materialId"
        params={{ materialId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.getValue("name")}
      </Link>
    ),
  },
  {
    accessorKey: "workshops",
    header: "Werkstätten",
    cell: ({ row }) => row.original.workshops?.join(", ") ?? "–",
  },
  {
    accessorKey: "pricingModel",
    header: "Modell",
  },
  {
    accessorKey: "unitPrice",
    header: ({ column }) => <ColumnHeader column={column} title="Preis (Voll)" />,
    cell: ({ row }) => formatCHF(row.original.unitPrice?.none ?? 0),
  },
  {
    accessorKey: "userCanAdd",
    header: "Selbstbedienung",
    cell: ({ row }) =>
      row.original.userCanAdd ? (
        <Badge variant="secondary">Ja</Badge>
      ) : (
        <Badge variant="outline">Nein (NFC)</Badge>
      ),
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

function CatalogPage() {
  const { data, loading } = useCollection<CatalogDoc>("catalog")
  const [createOpen, setCreateOpen] = useState(false)

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader
        title="Katalog"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Eintrag erstellen
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Katalog durchsuchen..."
      />
      <CreateCatalogDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

interface CreateCatalogFormValues {
  code: string
  name: string
  workshops: string
  pricingModel: string
  priceNone: string
  priceMember: string
  priceIntern: string
  userCanAdd: boolean
}

function CreateCatalogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { add, loading } = useFirestoreMutation()
  const { register, handleSubmit, reset } = useForm<CreateCatalogFormValues>({
    defaultValues: {
      pricingModel: "count",
      workshops: "holz",
      userCanAdd: true,
    },
  })

  const onSubmit = async (values: CreateCatalogFormValues) => {
    await add("catalog", {
      code: values.code,
      name: values.name,
      workshops: values.workshops.split(",").map((w) => w.trim()).filter(Boolean),
      pricingModel: values.pricingModel,
      unitPrice: {
        none: parseFloat(values.priceNone) || 0,
        member: parseFloat(values.priceMember) || 0,
        intern: parseFloat(values.priceIntern) || 0,
      },
      active: true,
      userCanAdd: values.userCanAdd,
      description: null,
    }, {
      successMessage: "Katalogeintrag erstellt",
    })
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Katalogeintrag erstellen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input placeholder="z.B. 1042" {...register("code", { required: true })} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="z.B. Sperrholz Birke 4mm" {...register("name", { required: true })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Werkstätten (kommagetrennt)</Label>
              <Input placeholder="holz, metall" {...register("workshops")} />
            </div>
            <div className="space-y-2">
              <Label>Preismodell</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" {...register("pricingModel")}>
                <option value="time">Zeit (Std.)</option>
                <option value="area">Fläche (m²)</option>
                <option value="length">Länge (m)</option>
                <option value="count">Stück</option>
                <option value="weight">Gewicht (kg)</option>
                <option value="direct">Betrag (CHF)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Preis (Voll)</Label>
              <Input type="number" step="0.01" {...register("priceNone", { required: true })} />
            </div>
            <div className="space-y-2">
              <Label>Preis (Mitglied)</Label>
              <Input type="number" step="0.01" {...register("priceMember")} />
            </div>
            <div className="space-y-2">
              <Label>Preis (Intern)</Label>
              <Input type="number" step="0.01" {...register("priceIntern")} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="userCanAdd" {...register("userCanAdd")} />
            <Label htmlFor="userCanAdd">Benutzer kann hinzufügen</Label>
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
