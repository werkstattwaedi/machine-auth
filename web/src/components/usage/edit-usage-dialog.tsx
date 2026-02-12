// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useRef } from "react"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import type {
  PricingConfig,
  WorkshopId,
  MachineConfig,
  DiscountLevel,
  ObjectSize,
  PrintMaterial,
  UnitCategory,
} from "@/lib/workshop-config"
import { MachineHoursForm, type MachineHoursData } from "./machine-hours-form"
import { MaterialForm, type MaterialData } from "./material-form"
import { SandblastingForm, type SandblastingData } from "./sandblasting-form"
import { ThreeDPrintForm, type ThreeDPrintData } from "./threed-print-form"
import { ServiceForm, type ServiceData } from "./service-form"

export interface UsageMaterialEditDoc {
  id: string
  description: string
  workshop: string
  type?: "material" | "machine_hours" | "service"
  details?: {
    category?: string
    quantity?: number
    lengthCm?: number
    widthCm?: number
    unitPrice?: number
    totalPrice?: number
    discountLevel?: string
    objectSize?: string
    weight_g?: number
    materialType?: string
    serviceDescription?: string
    serviceCost?: number
  }
}

interface EditUsageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: PricingConfig
  item: UsageMaterialEditDoc
  /** When provided, updates locally instead of writing to Firestore */
  onUpdateLocal?: (item: UsageMaterialEditDoc) => void
}

type FormKind = "machine_hours" | "material" | "sandblasting" | "3dprint" | "service"

function detectFormKind(item: UsageMaterialEditDoc, machine: MachineConfig | null): FormKind {
  const type = item.type ?? "material"
  if (type === "service") return "service"
  if (type === "material") return "material"
  // machine_hours: check details for sub-type
  if (item.details?.objectSize) return "sandblasting"
  if (item.details?.weight_g || item.details?.materialType) return "3dprint"
  if (machine?.pricingType === "objectSize") return "sandblasting"
  if (machine?.pricingType === "3dprint") return "3dprint"
  return "machine_hours"
}

function findMachine(config: PricingConfig, workshopId: string, description: string): MachineConfig | null {
  const ws = config.workshops[workshopId as WorkshopId]
  if (!ws) return null
  return ws.machines.find((m) => m.label === description) ?? ws.machines[0] ?? null
}

export function EditUsageDialog({
  open,
  onOpenChange,
  config,
  item,
  onUpdateLocal,
}: EditUsageDialogProps) {
  const mutation = useFirestoreMutation()
  const workshopId = item.workshop as WorkshopId
  const workshop = config.workshops[workshopId]
  const machine = findMachine(config, item.workshop, item.description)
  const formKind = detectFormKind(item, machine)

  const machineData = useRef<MachineHoursData | null>(null)
  const materialData = useRef<MaterialData | null>(null)
  const sandblastingData = useRef<SandblastingData | null>(null)
  const threeDData = useRef<ThreeDPrintData | null>(null)
  const serviceData = useRef<ServiceData | null>(null)

  /** Build the updated item from current form state. */
  const buildUpdatedItem = (): { description: string; details: Record<string, unknown> } | null => {
    if (formKind === "machine_hours" && machineData.current) {
      const d = machineData.current
      return {
        description: d.machineLabel,
        details: {
          category: "h",
          quantity: d.hours,
          unitPrice: d.unitPrice,
          totalPrice: d.totalPrice,
          discountLevel: d.discountLevel,
        },
      }
    } else if (formKind === "material" && materialData.current) {
      const d = materialData.current
      return {
        description: d.description,
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
    } else if (formKind === "sandblasting" && sandblastingData.current) {
      const d = sandblastingData.current
      return {
        description: d.machineLabel,
        details: {
          category: "obj",
          quantity: d.quantity,
          objectSize: d.objectSize,
          unitPrice: machine?.objectSizePrices?.[d.objectSize] ?? 0,
          totalPrice: d.totalPrice,
        },
      }
    } else if (formKind === "3dprint" && threeDData.current) {
      const d = threeDData.current
      return {
        description: d.machineLabel,
        details: {
          category: "g",
          quantity: d.weight_g,
          weight_g: d.weight_g,
          materialType: d.materialType,
          unitPrice: machine?.materialPrices?.[d.materialType] ?? 0,
          totalPrice: d.totalPrice,
        },
      }
    } else if (formKind === "service" && serviceData.current) {
      const d = serviceData.current
      return {
        description: d.description,
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
    const updated = buildUpdatedItem()
    if (!updated) return

    if (onUpdateLocal) {
      onUpdateLocal({
        ...item,
        description: updated.description,
        details: updated.details,
      })
      onOpenChange(false)
      return
    }

    await mutation.update("usage_material", item.id, updated, {
      successMessage: "Aktualisiert",
    })
    onOpenChange(false)
  }

  // Build initial data from item
  const machineInitial: MachineHoursData | undefined =
    formKind === "machine_hours" && machine
      ? {
          machineId: machine.id,
          machineLabel: item.description,
          hours: item.details?.quantity ?? 1,
          discountLevel: (item.details?.discountLevel as DiscountLevel) ?? "none",
          unitPrice: item.details?.unitPrice ?? 0,
          totalPrice: item.details?.totalPrice ?? 0,
        }
      : undefined

  const materialInitial: MaterialData | undefined =
    formKind === "material"
      ? {
          description: item.description,
          category: (item.details?.category as UnitCategory) ?? "stk",
          quantity: item.details?.quantity ?? 1,
          lengthCm: item.details?.lengthCm,
          widthCm: item.details?.widthCm,
          unitPrice: item.details?.unitPrice ?? 0,
          totalPrice: item.details?.totalPrice ?? 0,
          serviceDescription: item.details?.serviceDescription,
          serviceCost: item.details?.serviceCost,
        }
      : undefined

  const sandblastingInitial: SandblastingData | undefined =
    formKind === "sandblasting" && machine
      ? {
          machineLabel: item.description,
          quantity: item.details?.quantity ?? 1,
          objectSize: (item.details?.objectSize as ObjectSize) ?? "klein",
          totalPrice: item.details?.totalPrice ?? 0,
        }
      : undefined

  const threeDInitial: ThreeDPrintData | undefined =
    formKind === "3dprint" && machine
      ? {
          machineLabel: item.description,
          weight_g: item.details?.weight_g ?? item.details?.quantity ?? 0,
          materialType: (item.details?.materialType as PrintMaterial) ?? "PLA",
          totalPrice: item.details?.totalPrice ?? 0,
        }
      : undefined

  const serviceInitial: ServiceData | undefined =
    formKind === "service"
      ? {
          description: item.details?.serviceDescription ?? item.description,
          serviceCost: item.details?.serviceCost ?? item.details?.totalPrice ?? 0,
        }
      : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nutzung bearbeiten</DialogTitle>
          <DialogDescription>
            {workshop?.label ?? item.workshop}
          </DialogDescription>
        </DialogHeader>

        {formKind === "machine_hours" && machine && (
          <MachineHoursForm
            machines={[machine]}
            config={config}
            initial={machineInitial}
            onChange={(d) => { machineData.current = d }}
          />
        )}

        {formKind === "material" && workshop && (
          <MaterialForm
            categories={workshop.materialCategories}
            config={config}
            initial={materialInitial}
            onChange={(d) => { materialData.current = d }}
          />
        )}

        {formKind === "sandblasting" && machine && (
          <SandblastingForm
            machine={machine}
            config={config}
            initial={sandblastingInitial}
            onChange={(d) => { sandblastingData.current = d }}
          />
        )}

        {formKind === "3dprint" && machine && (
          <ThreeDPrintForm
            machine={machine}
            initial={threeDInitial}
            onChange={(d) => { threeDData.current = d }}
          />
        )}

        {formKind === "service" && (
          <ServiceForm
            initial={serviceInitial}
            onChange={(d) => { serviceData.current = d }}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            onClick={handleSave}
            disabled={mutation.loading}
            className="bg-cog-teal hover:bg-cog-teal-dark"
          >
            {mutation.loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
