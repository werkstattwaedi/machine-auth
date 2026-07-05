// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { Upload, Loader2, AlertTriangle, Info } from "lucide-react"
import { toast } from "sonner"
import type { DiffRow, DiffChange, ImportIssue } from "@oww/shared"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { PageHeader } from "@/components/admin/page-header"
import { InventoryTabs } from "@/components/admin/inventory-tabs"
import { Button } from "@modules/components/ui/button"
import { Badge } from "@modules/components/ui/badge"
import { Card } from "@modules/components/ui/card"
import { Checkbox } from "@modules/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"

export const Route = createFileRoute("/_authenticated/materials/import")({
  component: CatalogImportPage,
})

/** Server (`PreviewResult`) wire shape — kept local; web doesn't import functions types. */
interface ImportSummary {
  create: number
  update: number
  unchanged: number
  retire: number
  errors: number
  warnings: number
}
interface PreviewResult {
  diff: DiffRow[]
  issues: ImportIssue[]
  summary: ImportSummary
  missingSheets: string[]
  unconfiguredSheets: string[]
  hints: string[]
}
interface ApplyResult {
  created: number
  updated: number
  unchanged: number
  retired: number
  errors: number
  warnings: number
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(",")
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

const CHF = new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF" })

const FIELD_LABELS: Record<DiffChange["field"], string> = {
  name: "Name",
  labelName: "Etikett Name",
  labelMass: "Etikett Mass",
  price: "Preis",
  category: "Kategorie",
  pricingModel: "Abrechnung",
  workshops: "Werkstatt",
  active: "Status",
}

function formatValue(field: DiffChange["field"], value: unknown): string {
  if (field === "price" && typeof value === "number") return CHF.format(value)
  if (Array.isArray(value)) return value.join(" › ")
  if (field === "active") return value ? "aktiv" : "inaktiv"
  return String(value)
}

const KIND_BADGE: Record<DiffRow["kind"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  create: { label: "Neu", variant: "default" },
  update: { label: "Geändert", variant: "secondary" },
  unchanged: { label: "Unverändert", variant: "outline" },
  retire: { label: "Stilllegen", variant: "destructive" },
}

function SummaryBadge({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex flex-col items-center rounded-md border px-4 py-2">
      <span className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function CatalogImportPage() {
  const functions = useFunctions()
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileBase64, setFileBase64] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applyRetire, setApplyRetire] = useState(false)
  const [showUnchanged, setShowUnchanged] = useState(false)

  const apply = useAsyncMutation<ApplyResult>({ context: "admin.applyCatalogImport" })

  async function handleFile(file: File) {
    setFileName(file.name)
    setPreview(null)
    setPreviewError(null)
    setPreviewing(true)
    try {
      const base64 = await fileToBase64(file)
      setFileBase64(base64)
      const fn = rpcCallable<{ fileBase64: string }, PreviewResult>(
        functions,
        "catalogCall",
        "previewCatalogImport",
      )
      const result = await fn({ fileBase64: base64 })
      setPreview(result.data)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewing(false)
    }
  }

  async function handleApply() {
    if (!fileBase64) return
    let res: ApplyResult
    try {
      res = await apply.mutate(async () => {
        const fn = rpcCallable<{ fileBase64: string; applyRetire: boolean }, ApplyResult>(
          functions,
          "catalogCall",
          "applyCatalogImport",
        )
        const out = await fn({ fileBase64, applyRetire })
        return out.data
      })
    } catch {
      // useAsyncMutation surfaced the toast + telemetry for the apply itself.
      return
    }
    // The apply succeeded — confirm it before anything else can fail.
    const { created, updated, retired, errors } = res
    const skipped = errors ? ` · ${errors} Zeilen übersprungen` : ""
    toast.success(`Import übernommen: ${created} neu, ${updated} geändert, ${retired} stillgelegt${skipped}.`)
    // Best-effort re-preview so the table reflects the applied state. A
    // failure here must not look like the apply failed (it didn't).
    try {
      const fn = rpcCallable<{ fileBase64: string }, PreviewResult>(
        functions,
        "catalogCall",
        "previewCatalogImport",
      )
      const refreshed = await fn({ fileBase64 })
      setPreview(refreshed.data)
    } catch {
      toast.warning("Vorschau konnte nicht aktualisiert werden — Datei bei Bedarf erneut hochladen.")
    }
  }

  const s = preview?.summary
  const changeCount = s ? s.create + s.update + (applyRetire ? s.retire : 0) : 0
  const rows = (preview?.diff ?? []).filter((d) => showUnchanged || d.kind !== "unchanged")

  return (
    <div className="space-y-6">
      <PageHeader title="Inventar" />
      <InventoryTabs />
      <p className="text-sm text-muted-foreground">
        Marios Preislisten-Excel hochladen, Änderungen prüfen (Trockenlauf), dann übernehmen.
      </p>

      <Card className="p-4">
        <label className="flex items-center gap-3">
          <Button asChild variant="outline">
            <span>
              <Upload className="mr-2 h-4 w-4" />
              Excel auswählen
            </span>
          </Button>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <span className="text-sm text-muted-foreground">
            {fileName ?? "Keine Datei gewählt"}
          </span>
          {previewing && <Loader2 className="h-4 w-4 animate-spin" />}
        </label>
      </Card>

      {previewError && (
        <Card className="border-destructive p-4 text-sm text-destructive">
          Vorschau fehlgeschlagen: {previewError}
        </Card>
      )}

      {preview && (
        <>
          {preview.hints.map((h, i) => (
            <Card key={i} className="flex items-start gap-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{h}</span>
            </Card>
          ))}

          {(preview.missingSheets.length > 0 || preview.unconfiguredSheets.length > 0) && (
            <Card className="flex items-start gap-2 p-4 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {preview.missingSheets.length > 0 && (
                  <div>Fehlende Tabellenblätter: {preview.missingSheets.join(", ")}</div>
                )}
                {preview.unconfiguredSheets.length > 0 && (
                  <div>
                    Ohne Code-Spalten (übersprungen): {preview.unconfiguredSheets.join(", ")}
                  </div>
                )}
              </div>
            </Card>
          )}

          {s && (
            <div className="flex flex-wrap gap-3">
              <SummaryBadge label="Neu" value={s.create} tone="text-emerald-600" />
              <SummaryBadge label="Geändert" value={s.update} tone="text-blue-600" />
              <SummaryBadge label="Unverändert" value={s.unchanged} />
              <SummaryBadge label="Stilllegen" value={s.retire} tone="text-orange-600" />
              <SummaryBadge label="Fehler" value={s.errors} tone={s.errors ? "text-destructive" : ""} />
              <SummaryBadge label="Warnungen" value={s.warnings} tone={s.warnings ? "text-amber-600" : ""} />
            </div>
          )}

          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={applyRetire}
                    onCheckedChange={(v) => setApplyRetire(v === true)}
                  />
                  Nicht mehr gelistete Materialien deaktivieren ({s?.retire ?? 0})
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={showUnchanged}
                    onCheckedChange={(v) => setShowUnchanged(v === true)}
                  />
                  Unveränderte zeigen
                </label>
              </div>
              <Button onClick={handleApply} disabled={apply.loading || changeCount === 0}>
                {apply.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {changeCount} Änderungen übernehmen
              </Button>
            </div>

            <DiffTable rows={rows} />
          </Card>

          {preview.issues.length > 0 && (
            <Card className="space-y-2 p-4">
              <h3 className="font-medium">Probleme</h3>
              <ul className="space-y-1 text-sm">
                {preview.issues.map((iss, i) => (
                  <li
                    key={i}
                    className={iss.severity === "error" ? "text-destructive" : "text-amber-700"}
                  >
                    <span className="font-mono text-xs">
                      {iss.sheet} Z{iss.rowNumber}
                    </span>{" "}
                    {iss.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function DiffTable({ rows }: { rows: DiffRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine Änderungen.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Code</TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="w-24">Werkstatt</TableHead>
          <TableHead className="w-28">Aktion</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => {
          const badge = KIND_BADGE[d.kind]
          return (
            <TableRow key={`${d.workshop}-${d.code}`}>
              <TableCell className="font-mono text-xs">{d.code}</TableCell>
              <TableCell>{d.name}</TableCell>
              <TableCell className="text-muted-foreground">{d.workshop}</TableCell>
              <TableCell>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </TableCell>
              <TableCell className="text-sm">
                {d.kind === "update" && d.changes ? (
                  <ul className="space-y-0.5">
                    {d.changes.map((c, i) => (
                      <li key={i}>
                        <span className="text-muted-foreground">{FIELD_LABELS[c.field]}:</span>{" "}
                        <span className="line-through">{formatValue(c.field, c.from)}</span> →{" "}
                        <span className="font-medium">{formatValue(c.field, c.to)}</span>
                      </li>
                    ))}
                  </ul>
                ) : d.kind === "create" && d.entry ? (
                  <span className="text-muted-foreground">
                    {d.entry.category.join(" › ")} · {CHF.format(d.entry.unitPrice.default)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">–</span>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
