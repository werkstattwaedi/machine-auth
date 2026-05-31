// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Button } from "@modules/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { useForm } from "react-hook-form"
import { Loader2 } from "lucide-react"
import { rpcCallable } from "@modules/lib/rpc"
import { useFunctions } from "@modules/lib/firebase-context"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"

interface CreateUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CreateUserFormValues {
  firstName: string
  lastName: string
  email: string
}

export function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const functions = useFunctions()
  // ADR-0025: hook owns the toast, telemetry, and re-throw contract.
  const create = useAsyncMutation({
    context: "admin.createUser",
    successMessage: "Benutzer erstellt",
    errorMessage: "Benutzer konnte nicht erstellt werden",
  })
  const { register, handleSubmit, reset } = useForm<CreateUserFormValues>({
    defaultValues: { firstName: "", lastName: "", email: "" },
  })

  const onSubmit = async (values: CreateUserFormValues) => {
    try {
      await create.mutate(async () => {
        const createUser = rpcCallable(functions, "authCall", "createUser")
        await createUser(values)
      })
    } catch {
      // Hook already toasted + telemetered; keep the dialog open so
      // the user can adjust input and retry.
      return
    }
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Benutzer erstellen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="create-firstName">Vorname</Label>
              <Input id="create-firstName" {...register("firstName", { required: true })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-lastName">Nachname</Label>
              <Input id="create-lastName" {...register("lastName", { required: true })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-email">E-Mail</Label>
            <Input id="create-email" type="email" {...register("email", { required: true })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
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
