// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { Loader2, Mail } from "lucide-react"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

function LoginPage() {
  const { user, loading, signInWithEmail, completeSignIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [linkSent, setLinkSent] = useState(false)

  // Complete email link sign-in if arriving from email link
  useEffect(() => {
    completeSignIn()
      .then((completed) => {
        if (completed) {
          toast.success("Erfolgreich angemeldet")
          navigate({ to: "/" })
        }
      })
      .catch((err) => {
        toast.error(`Anmeldung fehlgeschlagen: ${err.message}`)
      })
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redirect if already signed in
  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/" })
    }
  }, [user, loading, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setSending(true)
    try {
      await signInWithEmail(email)
      setLinkSent(true)
      toast.success("Anmelde-Link gesendet!")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fehler"
      toast.error(`Fehler: ${message}`)
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Offene Werkstatt Wädenswil</CardTitle>
        </CardHeader>
        <CardContent>
          {linkSent ? (
            <div className="text-center space-y-2">
              <Mail className="h-8 w-8 mx-auto text-muted-foreground" />
              <p>Anmelde-Link wurde an <strong>{email}</strong> gesendet.</p>
              <p className="text-sm text-muted-foreground">
                Prüfe dein Postfach und klicke auf den Link.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="email"
                placeholder="deine@email.ch"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" className="w-full" disabled={sending}>
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Anmelde-Link senden
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
