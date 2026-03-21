// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useForm } from "react-hook-form"
import { Loader2 } from "lucide-react"
import { httpsCallable } from "firebase/functions"
import { useFunctions } from "@/lib/firebase-context"
import { useState } from "react"
import { toast } from "sonner"

interface CreateUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CreateUserFormValues {
  displayName: string
  firstName: string
  lastName: string
  email: string
}

export function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const functions = useFunctions()
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, reset } = useForm<CreateUserFormValues>({
    defaultValues: { displayName: "", firstName: "", lastName: "", email: "" },
  })

  const onSubmit = async (values: CreateUserFormValues) => {
    setLoading(true)
    try {
      const createUser = httpsCallable(functions, "createUser")
      await createUser(values)
      toast.success("Benutzer erstellt")
      reset()
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.message ?? "Benutzer konnte nicht erstellt werden")
    } finally {
      setLoading(false)
    }
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
            <Label htmlFor="create-displayName">Anzeigename (optional)</Label>
            <Input id="create-displayName" placeholder="z.B. MikeS" {...register("displayName")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-email">E-Mail</Label>
            <Input id="create-email" type="email" {...register("email", { required: true })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
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
