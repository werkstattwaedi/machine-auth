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
import { serverTimestamp } from "firebase/firestore"

export const Route = createFileRoute("/_authenticated/_admin/materials/")({
  component: MaterialsPage,
})

interface MaterialDoc {
  name: string
  workshop: string
  category: string
  unitPrice: number
  unit: string
  active: boolean
  shortlistGroup?: string | null
}

const columns: ColumnDef<MaterialDoc & { id: string }>[] = [
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
    accessorKey: "workshop",
    header: ({ column }) => <ColumnHeader column={column} title="Werkstatt" />,
  },
  {
    accessorKey: "category",
    header: "Kategorie",
  },
  {
    accessorKey: "unitPrice",
    header: ({ column }) => <ColumnHeader column={column} title="Preis/Einheit" />,
    cell: ({ row }) => `${formatCHF(row.original.unitPrice)}/${row.original.unit}`,
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

function MaterialsPage() {
  const { data, loading } = useCollection<MaterialDoc>("materials")
  const [createOpen, setCreateOpen] = useState(false)

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader
        title="Materialien"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Material erstellen
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Material suchen..."
      />
      <CreateMaterialDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

interface CreateMaterialFormValues {
  name: string
  workshop: string
  category: string
  unitPrice: string
  unit: string
  shortlistGroup: string
}

function CreateMaterialDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { add, loading } = useFirestoreMutation()
  const { register, handleSubmit, reset } = useForm<CreateMaterialFormValues>({
    defaultValues: {
      workshop: "holz",
      category: "m2",
      unit: "m\u00B2",
    },
  })

  const onSubmit = async (values: CreateMaterialFormValues) => {
    await add("materials", {
      name: values.name,
      workshop: values.workshop,
      category: values.category,
      unitPrice: parseFloat(values.unitPrice) || 0,
      unit: values.unit,
      active: true,
      shortlistGroup: values.shortlistGroup || null,
      description: null,
      created: serverTimestamp(),
    }, {
      successMessage: "Material erstellt",
    })
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Material erstellen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="z.B. Sperrholz Birke 10mm" {...register("name", { required: true })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Werkstatt</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" {...register("workshop")}>
                <option value="holz">Holz</option>
                <option value="metall">Metall</option>
                <option value="textil">Textil</option>
                <option value="elektronik">Elektronik</option>
                <option value="allgemein">Allgemein</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Kategorie</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" {...register("category")}>
                <option value="m2">m² (Fläche)</option>
                <option value="m">m (Länge)</option>
                <option value="stk">Stk. (Stück)</option>
                <option value="chf">CHF (Betrag)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Preis pro Einheit (CHF)</Label>
              <Input type="number" step="0.01" {...register("unitPrice", { required: true })} />
            </div>
            <div className="space-y-2">
              <Label>Einheit (Anzeige)</Label>
              <Input placeholder="z.B. m², m, Stk." {...register("unit", { required: true })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Shortlist-Gruppe (optional)</Label>
            <Input placeholder="z.B. sperrholz" {...register("shortlistGroup")} />
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
