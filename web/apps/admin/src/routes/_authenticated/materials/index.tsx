// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { catalogCollection } from "@modules/lib/firestore-helpers"
import type { PricingModel } from "@modules/lib/firestore-entities"
import { PageLoading } from "@modules/components/page-loading"
import { DataTable, ColumnHeader } from "@modules/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { type ColumnDef } from "@tanstack/react-table"
import { Plus, Loader2, Upload } from "lucide-react"
import { useState } from "react"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { useForm } from "react-hook-form"
import { formatCHF } from "@modules/lib/format"
import type { CatalogItem } from "@modules/lib/workshop-config"
import { CatalogFormFields, type CatalogFormValues } from "@/components/admin/catalog-form-fields"

export const Route = createFileRoute("/_authenticated/materials/")({
  component: CatalogPage,
})

const columns: ColumnDef<CatalogItem>[] = [
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
    id: "pricingModel",
    header: "Modell",
    cell: ({ row }) => row.original.variants?.[0]?.pricingModel ?? "—",
  },
  {
    id: "unitPrice",
    header: ({ column }) => <ColumnHeader column={column} title="Preis (Voll)" />,
    cell: ({ row }) =>
      formatCHF(row.original.variants?.[0]?.unitPrice?.default ?? 0),
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
  const db = useDb()
  const { data, loading } = useCollection(catalogCollection(db))
  const [createOpen, setCreateOpen] = useState(false)

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader
        title="Katalog"
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/materials/import">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Eintrag erstellen
            </Button>
          </div>
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

function CreateCatalogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const functions = useFunctions()
  // Catalog writes flow through upsertCatalogItem; client-side Firestore
  // writes to catalog are denied by rules so the `code` uniqueness
  // invariant can be enforced server-side. See ADR-0026.
  const create = useAsyncMutation({
    context: "admin.upsertCatalogItem.create",
    successMessage: "Katalogeintrag erstellt",
    errorMessage: "Katalogeintrag konnte nicht erstellt werden",
  })
  const { register, handleSubmit, reset, control } = useForm<CatalogFormValues>({
    defaultValues: {
      pricingModel: "count",
      workshops: "holz",
      userCanAdd: true,
    },
  })

  const onSubmit = async (values: CatalogFormValues) => {
    const defaultPrice = parseFloat(values.priceNone) || 0
    const memberPrice = parseFloat(values.priceMember) || 0
    const variant = {
      id: "default",
      pricingModel: values.pricingModel as PricingModel,
      unitPrice:
        memberPrice !== defaultPrice
          ? { default: defaultPrice, member: memberPrice }
          : { default: defaultPrice },
    }
    try {
      await create.mutate(async () => {
        const fn = rpcCallable<
          {
            code: string
            name: string
            description: string | null
            workshops: string[]
            category: string[]
            variants: typeof variant[]
            variantIds: string[]
            active: boolean
            userCanAdd: boolean
          },
          { id: string }
        >(functions, "catalogCall", "upsertCatalogItem")
        await fn({
          code: values.code,
          name: values.name,
          description: values.description || null,
          workshops: values.workshops
            .split(",")
            .map((w) => w.trim())
            .filter(Boolean),
          // New entries start in the placeholder "Sonstiges" category with
          // just their base variant; extra variants can be added on the
          // detail page.
          category: ["Sonstiges"],
          variants: [variant],
          variantIds: Array.isArray(values.variantIds) ? values.variantIds : [],
          active: true,
          userCanAdd: values.userCanAdd,
        })
      })
    } catch {
      // Stay open so the user can adjust (e.g. duplicate code) and retry.
      return
    }
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
          <CatalogFormFields register={register} control={control} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={create.loading}>
              {create.loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Erstellen
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
