// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Inventar · Preislisten — each saved list is a printable Aushang.
// "Veraltet" = listed items/prices changed since the PDF was generated;
// open the row to adjust and re-generate.

import { createFileRoute, Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import {
  catalogCollection,
  priceListsCollection,
} from "@modules/lib/firestore-helpers"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useForm } from "react-hook-form"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { InventoryTabs } from "@/components/admin/inventory-tabs"
import {
  priceListFreshness,
  type PriceListFreshness,
} from "@/lib/price-list-stale"
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
import { AlertTriangle, Loader2, MoveRight, Plus } from "lucide-react"

export const Route = createFileRoute("/_authenticated/price-lists/")({
  component: PriceListsPage,
})

function FreshnessBadge({ freshness }: { freshness: PriceListFreshness }) {
  switch (freshness) {
    case "current":
      return <Badge variant="secondary">aktuell</Badge>
    case "stale":
      return (
        <Badge variant="destructive">
          <AlertTriangle className="mr-1 h-3 w-3" />
          veraltet
        </Badge>
      )
    case "never":
      return <Badge variant="outline">nie generiert</Badge>
  }
}

function PriceListsPage() {
  const db = useDb()
  const { data, loading } = useCollection(priceListsCollection(db))
  const { data: catalog } = useCollection(catalogCollection(db))
  const [createOpen, setCreateOpen] = useState(false)

  const rows = useMemo(() => {
    const modifiedAt = new Map(catalog.map((c) => [c.id, c.modifiedAt]))
    return data
      .map((list) => ({
        ...list,
        freshness: priceListFreshness(list, modifiedAt),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH"))
  }, [data, catalog])

  if (loading) return <PageLoading />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventar"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Neue Preisliste
          </Button>
        }
      />
      <InventoryTabs />
      <p className="text-sm text-muted-foreground">
        Gespeicherte Auswahl, druckbar als Aushang. „Veraltet“ = Artikel oder
        Preise haben sich seit dem Generieren geändert — Zeile öffnen und neu
        generieren.
      </p>

      <Card className="px-4 py-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Einträge</TableHead>
              <TableHead>Generiert</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((list) => (
              <TableRow key={list.id}>
                <TableCell>
                  <Link
                    to="/price-lists/$priceListId"
                    params={{ priceListId: list.id }}
                    className="font-medium hover:underline"
                  >
                    {list.name}
                  </Link>
                  {!list.active && (
                    <Badge variant="outline" className="ml-2">
                      inaktiv
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {list.items?.length ?? 0}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {list.generatedAt ? formatDate(list.generatedAt) : "–"}
                </TableCell>
                <TableCell>
                  <FreshnessBadge freshness={list.freshness} />
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    to="/price-lists/$priceListId"
                    params={{ priceListId: list.id }}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    öffnen
                    <MoveRight className="h-3.5 w-3.5" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CreatePriceListDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

interface CreateFormValues {
  name: string
}

function CreatePriceListDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const db = useDb()
  const { add, loading } = useFirestoreMutation()
  const { register, handleSubmit, reset } = useForm<CreateFormValues>({
    defaultValues: { name: "" },
  })

  const onSubmit = async (values: CreateFormValues) => {
    try {
      await add(
        priceListsCollection(db),
        {
          name: values.name,
          items: [],
          active: true,
        },
        { successMessage: "Preisliste erstellt" },
      )
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
            <Input
              {...register("name", { required: true })}
              placeholder="z.B. Holzwerkstatt Materialien"
            />
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
