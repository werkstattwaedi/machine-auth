// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { z } from "zod/v4/mini"
import { useAuth } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { toast } from "sonner"
import { Loader2, Mail } from "lucide-react"
import { GoogleIcon } from "@modules/components/icons/google"

const loginSearchSchema = z.object({
  redirect: z.optional(z.string()),
})

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  component: LoginPage,
})

function LoginPage() {
  const { user, loading, signInWithEmail, signInWithGoogle, completeSignIn, pendingGoogleLink } = useAuth()
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()
  const targetPath = redirectTo || "/visit"
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false)
  const [linkSent, setLinkSent] = useState(false)
  const [showLinkHint, setShowLinkHint] = useState(false)

  // Complete email link sign-in if arriving from email link
  useEffect(() => {
    completeSignIn()
      .then((completed) => {
        if (completed) {
          toast.success("Erfolgreich angemeldet")
          const storedRedirect = window.localStorage.getItem("loginRedirect")
          window.localStorage.removeItem("loginRedirect")
          const target = storedRedirect || targetPath
          navigate({ to: pendingGoogleLink ? "/link-account" : target })
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
      navigate({ to: pendingGoogleLink ? "/link-account" : targetPath })
    }
  }, [user, loading, pendingGoogleLink, navigate, targetPath])

  const handleGoogleSignIn = async () => {
    setSigningInWithGoogle(true)
    try {
      await signInWithGoogle()
      navigate({ to: targetPath })
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "auth/account-exists-with-different-credential"
      ) {
        setShowLinkHint(true)
        toast.info("Bitte zuerst per E-Mail-Link anmelden")
      } else if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "auth/popup-closed-by-user"
      ) {
        // User closed the popup — no error needed
      } else {
        const message = err instanceof Error ? err.message : "Fehler"
        toast.error(`Anmeldung fehlgeschlagen: ${message}`)
      }
    } finally {
      setSigningInWithGoogle(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setSending(true)
    try {
      if (redirectTo) {
        window.localStorage.setItem("loginRedirect", redirectTo)
      }
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
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4">
          <img
            src="/logo_oww.png"
            alt="Offene Werkstatt Wädenswil"
            className="h-14"
          />
        </div>

        <div className="border border-border rounded p-6 space-y-4">
          <h2 className="text-lg font-bold text-center">Anmelden</h2>
          {linkSent ? (
            <div className="text-center space-y-3">
              <Mail className="h-10 w-10 mx-auto text-cog-teal" />
              <p className="text-sm">Anmelde-Link wurde an <strong>{email}</strong> gesendet.</p>
              <p className="text-sm text-muted-foreground">
                Prüfe dein Postfach und klicke auf den Link.
              </p>
            </div>
          ) : (
            <>
              {showLinkHint && (
                <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
                  Ein Konto mit dieser E-Mail existiert bereits. Melde dich per E-Mail-Link an,
                  um dein Google-Konto zu verknüpfen.
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  type="email"
                  placeholder="deine@email.ch"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Button
                  type="submit"
                  className="w-full bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
                  disabled={sending}
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Anmelde-Link senden
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">oder</span>
                </div>
              </div>

              <Button
                onClick={handleGoogleSignIn}
                className="w-full bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-semibold"
                disabled={signingInWithGoogle}
              >
                {signingInWithGoogle ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <GoogleIcon className="h-4 w-4 mr-2" />
                )}
                Mit Google anmelden
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
