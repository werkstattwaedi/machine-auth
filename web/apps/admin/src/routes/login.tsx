// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useAuth } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { toast } from "sonner"
import { Loader2, Mail } from "lucide-react"
import { GoogleIcon } from "@modules/components/icons/google"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})

function LoginPage() {
  const { user, loading, requestLoginEmail, verifyLoginCode, signInWithGoogle, pendingGoogleLink } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false)
  const [codeRequested, setCodeRequested] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [showLinkHint, setShowLinkHint] = useState(false)

  // Redirect if already signed in
  useEffect(() => {
    if (!loading && user) {
      navigate({ to: pendingGoogleLink ? "/link-account" : "/users" })
    }
  }, [user, loading, pendingGoogleLink, navigate])

  const handleGoogleSignIn = async () => {
    setSigningInWithGoogle(true)
    try {
      await signInWithGoogle()
      navigate({ to: "/users" })
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "auth/account-exists-with-different-credential"
      ) {
        setShowLinkHint(true)
        toast.info("Bitte zuerst per E-Mail-Code anmelden")
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

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setSending(true)
    try {
      await requestLoginEmail(email)
      setCodeRequested(true)
      setCodeError(null)
      toast.success("E-Mail gesendet!")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fehler"
      toast.error(`Fehler: ${message}`)
    } finally {
      setSending(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) return

    setVerifying(true)
    setCodeError(null)
    try {
      await verifyLoginCode(email, code)
      toast.success("Erfolgreich angemeldet")
      // Redirect handled by useEffect above once user state updates.
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Code falsch."
      setCodeError(message)
      setCode("")
    } finally {
      setVerifying(false)
    }
  }

  const handleUseDifferentEmail = () => {
    setCodeRequested(false)
    setCode("")
    setCodeError(null)
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
          <p className="text-sm text-muted-foreground">Administration</p>
        </div>

        <div className="border border-border rounded p-6 space-y-4">
          <h2 className="text-lg font-bold text-center">Anmelden</h2>
          {codeRequested ? (
            <div className="space-y-4" data-testid="login-code-stage">
              <div className="text-center space-y-2">
                <Mail className="h-10 w-10 mx-auto text-cog-teal" />
                <p className="text-sm">
                  Wir haben eine E-Mail an <strong>{email}</strong> gesendet.
                </p>
                <p className="text-sm text-muted-foreground">
                  Gib den 6-stelligen Code ein oder klicke auf den Link in der E-Mail.
                </p>
              </div>

              <form onSubmit={handleVerifyCode} className="space-y-3">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoFocus
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-xl tracking-widest"
                  data-testid="login-code-input"
                  aria-label="6-stelliger Code"
                />
                {codeError && (
                  <p className="text-sm text-red-600" data-testid="login-code-error">{codeError}</p>
                )}
                <Button
                  type="submit"
                  className="w-full bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
                  disabled={verifying || code.length !== 6}
                  data-testid="login-code-submit"
                >
                  {verifying ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Anmelden
                </Button>
              </form>

              <button
                type="button"
                onClick={handleUseDifferentEmail}
                className="w-full text-sm text-muted-foreground hover:text-foreground underline"
              >
                Andere E-Mail-Adresse verwenden
              </button>
            </div>
          ) : (
            <>
              {showLinkHint && (
                <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
                  Ein Konto mit dieser E-Mail existiert bereits. Melde dich per E-Mail-Code an,
                  um dein Google-Konto zu verknüpfen.
                </div>
              )}

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

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">oder</span>
                </div>
              </div>

              <form onSubmit={handleRequestCode} className="space-y-4" data-testid="login-email-stage">
                <Input
                  type="email"
                  placeholder="deine@email.ch"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="login-email-input"
                />
                <Button
                  type="submit"
                  className="w-full bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
                  disabled={sending}
                  data-testid="login-email-submit"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Code per E-Mail senden
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
