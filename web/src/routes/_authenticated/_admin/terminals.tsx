// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { PageLoading } from "@/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import { type ColumnDef } from "@tanstack/react-table"
import { Download, Loader2 } from "lucide-react"
import { useState } from "react"
import { getAuth } from "firebase/auth"
import { toast } from "sonner"

export const Route = createFileRoute("/_authenticated/_admin/terminals")({
  component: TerminalsPage,
})

interface MacoDoc {
  name: string
}

const columns: ColumnDef<MacoDoc & { id: string }>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <ColumnHeader column={column} title="Device ID" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span>,
  },
  {
    accessorKey: "name",
    header: ({ column }) => <ColumnHeader column={column} title="Name" />,
  },
]

function TerminalsPage() {
  const { data, loading } = useCollection<MacoDoc>("maco")
  const [importing, setImporting] = useState(false)

  const handleImport = async () => {
    setImporting(true)
    try {
      const auth = getAuth()
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error("Nicht angemeldet")

      // Fetch devices from Particle Cloud via admin API
      const resp = await fetch(
        `${import.meta.env.DEV ? "http://127.0.0.1:5001/oww-maschinenfreigabe/us-central1" : ""}/admin/particle/devices`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      if (!resp.ok) throw new Error("Particle API Fehler")

      const devices: { id: string; name: string }[] = await resp.json()
      const existingIds = new Set(data.map((d) => d.id))
      const newDevices = devices.filter((d) => !existingIds.has(d.id))

      if (newDevices.length === 0) {
        toast.info("Keine neuen Geräte gefunden.")
        return
      }

      // Import each new device
      for (const device of newDevices) {
        await fetch(
          `${import.meta.env.DEV ? "http://127.0.0.1:5001/oww-maschinenfreigabe/us-central1" : ""}/admin/particle/import-device`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ deviceId: device.id, name: device.name }),
          }
        )
      }
      toast.success(`${newDevices.length} Gerät(e) importiert.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import fehlgeschlagen")
    } finally {
      setImporting(false)
    }
  }

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader
        title="Terminals"
        action={
          <Button onClick={handleImport} disabled={importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            Particle Import
          </Button>
        }
      />
      <DataTable columns={columns} data={data} searchKey="name" searchPlaceholder="Terminal suchen..." />
    </div>
  )
}
