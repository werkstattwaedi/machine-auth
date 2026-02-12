// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useRef } from "react"
import { serverTimestamp } from "firebase/firestore"
import { useAuth } from "@/lib/auth"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { userRef } from "@/lib/firestore-helpers"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import type {
  PricingConfig,
  WorkshopId,
  WorkshopConfig,
  MachineConfig,
} from "@/lib/workshop-config"
import { getSortedWorkshops } from "@/lib/workshop-config"
import { MachineHoursForm, type MachineHoursData } from "./machine-hours-form"
import { MaterialForm, type MaterialData } from "./material-form"
import { SandblastingForm, type SandblastingData } from "./sandblasting-form"
import { ThreeDPrintForm, type ThreeDPrintData } from "./threed-print-form"
import { ServiceForm, type ServiceData } from "./service-form"

type ItemType = "machine_hours" | "material" | "sandblasting" | "3dprint" | "service"

/** Shape passed to onSaveLocal (everything except the generated id) */
export interface LocalItemData {
  description: string
  workshop: string
  type: "material" | "machine_hours" | "service"
  details: Record<string, unknown>
}

interface AddUsageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: PricingConfig
  preselectedWorkshop?: WorkshopId
  /** When provided, saves locally instead of writing to Firestore */
  onSaveLocal?: (item: LocalItemData) => void
}

export function AddUsageDialog({
  open,
  onOpenChange,
  config,
  preselectedWorkshop,
  onSaveLocal,
}: AddUsageDialogProps) {
  const { user } = useAuth()
  const mutation = useFirestoreMutation()
  const [workshopId, setWorkshopId] = useState<WorkshopId | "">(preselectedWorkshop ?? "")
  const [itemType, setItemType] = useState<ItemType | "">("")
  const [selectedMachine, setSelectedMachine] = useState<MachineConfig | null>(null)

  // Form data refs (updated via onChange callbacks)
  const machineData = useRef<MachineHoursData | null>(null)
  const materialData = useRef<MaterialData | null>(null)
  const sandblastingData = useRef<SandblastingData | null>(null)
  const threeDData = useRef<ThreeDPrintData | null>(null)
  const serviceData = useRef<ServiceData | null>(null)

  const workshop: WorkshopConfig | null = workshopId ? config.workshops[workshopId] ?? null : null
  const sortedWorkshops = getSortedWorkshops(config)

  // Determine available item types for the selected workshop
  const availableTypes: { value: ItemType; label: string; machine?: MachineConfig }[] = []
  if (workshop) {
    for (const m of workshop.machines) {
      if (m.pricingType === "objectSize") {
        availableTypes.push({ value: "sandblasting", label: m.label, machine: m })
      } else if (m.pricingType === "3dprint") {
        availableTypes.push({ value: "3dprint", label: m.label, machine: m })
      } else {
        availableTypes.push({ value: "machine_hours", label: m.label, machine: m })
      }
    }
    if (workshop.materialCategories.length > 0) {
      availableTypes.push({ value: "material", label: "Material" })
    }
    if (workshop.hasServiceItems) {
      availableTypes.push({ value: "service", label: "Dienstleistung / Diverses" })
    }
  }

  const resetForm = () => {
    setWorkshopId(preselectedWorkshop ?? "")
    setItemType("")
    setSelectedMachine(null)
    machineData.current = null
    materialData.current = null
    sandblastingData.current = null
    threeDData.current = null
    serviceData.current = null
  }

  const handleSelectType = (type: ItemType, machine?: MachineConfig) => {
    setItemType(type)
    setSelectedMachine(machine ?? null)
  }

  /** Build the core item data from current form state (no userId/timestamps). */
  const buildItemData = (): LocalItemData | null => {
    if (!workshopId) return null

    if (itemType === "machine_hours" && machineData.current) {
      const d = machineData.current
      return {
        workshop: workshopId,
        description: d.machineLabel,
        type: "machine_hours",
        details: {
          category: "h",
          quantity: d.hours,
          unitPrice: d.unitPrice,
          totalPrice: d.totalPrice,
          discountLevel: d.discountLevel,
        },
      }
    } else if (itemType === "material" && materialData.current) {
      const d = materialData.current
      return {
        workshop: workshopId,
        description: d.description,
        type: "material",
        details: {
          category: d.category,
          quantity: d.quantity,
          lengthCm: d.lengthCm ?? null,
          widthCm: d.widthCm ?? null,
          unitPrice: d.unitPrice,
          totalPrice: d.totalPrice,
          serviceDescription: d.serviceDescription ?? null,
          serviceCost: d.serviceCost ?? null,
        },
      }
    } else if (itemType === "sandblasting" && sandblastingData.current) {
      const d = sandblastingData.current
      return {
        workshop: workshopId,
        description: d.machineLabel,
        type: "machine_hours",
        details: {
          category: "obj",
          quantity: d.quantity,
          objectSize: d.objectSize,
          unitPrice: (selectedMachine?.objectSizePrices?.[d.objectSize] ?? 0),
          totalPrice: d.totalPrice,
        },
      }
    } else if (itemType === "3dprint" && threeDData.current) {
      const d = threeDData.current
      return {
        workshop: workshopId,
        description: d.machineLabel,
        type: "machine_hours",
        details: {
          category: "g",
          quantity: d.weight_g,
          weight_g: d.weight_g,
          materialType: d.materialType,
          unitPrice: (selectedMachine?.materialPrices?.[d.materialType] ?? 0),
          totalPrice: d.totalPrice,
        },
      }
    } else if (itemType === "service" && serviceData.current) {
      const d = serviceData.current
      return {
        workshop: workshopId,
        description: d.description,
        type: "service",
        details: {
          category: "chf",
          quantity: 1,
          unitPrice: d.serviceCost,
          totalPrice: d.serviceCost,
          serviceDescription: d.description,
          serviceCost: d.serviceCost,
        },
      }
    }

    return null
  }

  const handleSave = async () => {
    const itemData = buildItemData()
    if (!itemData) return

    if (onSaveLocal) {
      onSaveLocal(itemData)
      resetForm()
      onOpenChange(false)
      return
    }

    if (!user) return

    await mutation.add("usage_material", {
      ...itemData,
      userId: userRef(user.uid),
      created: serverTimestamp(),
      checkout: null,
    }, {
      successMessage: "Nutzung erfasst",
      errorMessage: "Fehler beim Speichern",
    })
    resetForm()
    onOpenChange(false)
  }

  const isValid =
    (itemType === "machine_hours" && machineData.current !== null) ||
    (itemType === "material" && materialData.current !== null) ||
    (itemType === "sandblasting" && sandblastingData.current !== null) ||
    (itemType === "3dprint" && threeDData.current !== null) ||
    (itemType === "service" && serviceData.current !== null)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nutzung erfassen</DialogTitle>
          <DialogDescription>
            Wähle eine Werkstatt und den Nutzungstyp.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Workshop selection */}
        {!workshopId && (
          <div className="space-y-2">
            <Label className="text-sm font-bold">Werkstatt</Label>
            <div className="grid grid-cols-2 gap-2">
              {sortedWorkshops.map(([id, ws]) => (
                <button
                  key={id}
                  type="button"
                  className="rounded-none border border-[#ccc] px-3 py-2 text-sm text-left hover:bg-cog-teal-light hover:border-cog-teal transition-colors"
                  onClick={() => setWorkshopId(id)}
                >
                  {ws.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Type selection */}
        {workshopId && !itemType && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-sm text-cog-teal hover:underline"
                onClick={() => setWorkshopId("")}
              >
                &larr; Werkstatt
              </button>
              <span className="text-sm font-bold">{workshop?.label}</span>
            </div>
            <Label className="text-sm font-bold">Was möchtest du erfassen?</Label>
            <div className="space-y-2">
              {availableTypes.map((t, i) => (
                <button
                  key={`${t.value}-${i}`}
                  type="button"
                  className="w-full rounded-none border border-[#ccc] px-3 py-2 text-sm text-left hover:bg-cog-teal-light hover:border-cog-teal transition-colors"
                  onClick={() => handleSelectType(t.value, t.machine)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Form */}
        {workshopId && itemType && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-sm text-cog-teal hover:underline"
                onClick={() => { setItemType(""); setSelectedMachine(null) }}
              >
                &larr; Zurück
              </button>
              <span className="text-sm font-bold">{workshop?.label}</span>
            </div>

            {itemType === "machine_hours" && selectedMachine && workshop && (
              <MachineHoursForm
                machines={[selectedMachine]}
                config={config}
                onChange={(d) => { machineData.current = d }}
              />
            )}

            {itemType === "material" && workshop && (
              <MaterialForm
                categories={workshop.materialCategories}
                config={config}
                onChange={(d) => { materialData.current = d }}
              />
            )}

            {itemType === "sandblasting" && selectedMachine && (
              <SandblastingForm
                machine={selectedMachine}
                config={config}
                onChange={(d) => { sandblastingData.current = d }}
              />
            )}

            {itemType === "3dprint" && selectedMachine && (
              <ThreeDPrintForm
                machine={selectedMachine}
                onChange={(d) => { threeDData.current = d }}
              />
            )}

            {itemType === "service" && (
              <ServiceForm
                onChange={(d) => { serviceData.current = d }}
              />
            )}
          </div>
        )}

        {workshopId && itemType && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { resetForm(); onOpenChange(false) }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isValid || mutation.loading}
              className="bg-cog-teal hover:bg-cog-teal-dark"
            >
              {mutation.loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Speichern
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
