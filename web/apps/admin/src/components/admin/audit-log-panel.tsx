// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import { auditLogCollection } from "@modules/lib/firestore-helpers"
import { where, orderBy, limit } from "firebase/firestore"
import { formatDateTime } from "@modules/lib/format"
import { Badge } from "@modules/components/ui/badge"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { FileText } from "lucide-react"

interface AuditLogPanelProps {
  /** Filter by collection name */
  collection?: string
  /** Filter by document ID */
  docId?: string
  /** Max entries to show */
  maxEntries?: number
}

const OPERATION_LABELS: Record<string, string> = {
  create: "Erstellt",
  update: "Aktualisiert",
  delete: "Gelöscht",
}

const OPERATION_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  create: "default",
  update: "secondary",
  delete: "destructive",
}

export function AuditLogPanel({ collection: filterCollection, docId: filterDocId, maxEntries = 50 }: AuditLogPanelProps) {
  const db = useDb()
  const constraints = []
  if (filterCollection) constraints.push(where("collection", "==", filterCollection))
  if (filterDocId) constraints.push(where("docId", "==", filterDocId))
  constraints.push(orderBy("timestamp", "desc"))
  constraints.push(limit(maxEntries))

  const { data: entries, loading } = useCollection(auditLogCollection(db), ...constraints)

  if (loading) return <PageLoading />

  if (entries.length === 0) {
    return <EmptyState icon={FileText} title="Keine Einträge" description="Es sind keine Audit-Log-Einträge vorhanden." />
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 text-sm border-b pb-2">
          <div className="text-xs text-muted-foreground whitespace-nowrap pt-0.5">
            {formatDateTime(entry.timestamp)}
          </div>
          <Badge variant={OPERATION_VARIANT[entry.operation] ?? "outline"} className="text-xs">
            {OPERATION_LABELS[entry.operation] ?? entry.operation}
          </Badge>
          <div className="flex-1 min-w-0">
            <span className="font-mono text-xs text-muted-foreground">
              {entry.collection}/{entry.docId}
            </span>
            {entry.actorUid && (
              <span className="text-xs text-muted-foreground ml-2">
                von {entry.actorUid}
              </span>
            )}
            {entry.operation === "update" && entry.before && entry.after && (
              <div className="mt-1 text-xs text-muted-foreground">
                {renderChangedFields(entry.before, entry.after)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function renderChangedFields(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const changed: string[] = []
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of allKeys) {
    if (key === "modifiedBy" || key === "modifiedAt") continue
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push(key)
    }
  }
  return changed.length > 0 ? `Geändert: ${changed.join(", ")}` : "Keine Änderungen"
}
