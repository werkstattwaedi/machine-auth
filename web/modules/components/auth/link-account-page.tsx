// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Shared "link Google account to existing email account" page. Both apps
// differ only in the post-link redirect target and the optional subtitle.

import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Loader2, Link as LinkIcon } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"
import { GoogleIcon } from "@modules/components/icons/google"

export interface LinkAccountPageProps {
  /** Where to send the user once linking succeeds or is skipped. */
  defaultRedirect: string
  /** Optional caption under the logo (e.g. "Administration"). */
  subtitle?: string
}

export function LinkAccountPage({ defaultRedirect, subtitle }: LinkAccountPageProps) {
  const { user, loading, pendingGoogleLink, linkGoogle, clearPendingGoogleLink } = useAuth()
  const navigate = useNavigate()
  const [linking, setLinking] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" })
    }
  }, [user, loading, navigate])

  // Nothing to link — go to the app
  useEffect(() => {
    if (!loading && user && !pendingGoogleLink) {
      navigate({ to: defaultRedirect })
    }
  }, [user, loading, pendingGoogleLink, navigate, defaultRedirect])

  const handleLink = async () => {
    setLinking(true)
    try {
      await linkGoogle()
      toast.success("Google-Konto verknüpft!")
      navigate({ to: defaultRedirect })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fehler"
      toast.error(`Verknüpfung fehlgeschlagen: ${message}`)
    } finally {
      setLinking(false)
    }
  }

  const handleSkip = () => {
    clearPendingGoogleLink()
    navigate({ to: defaultRedirect })
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
          <img src="/logo_oww.png" alt="Offene Werkstatt Wädenswil" className="h-14" />
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        <div className="border border-border rounded p-6 space-y-4">
          <div className="flex justify-center">
            <LinkIcon className="h-10 w-10 text-cog-teal" />
          </div>
          <h2 className="text-lg font-bold text-center">Google-Konto verknüpfen</h2>
          <p className="text-sm text-muted-foreground text-center">
            Dein Konto existiert bereits. Verknüpfe jetzt dein Google-Konto,
            damit du dich künftig auch mit Google anmelden kannst.
          </p>

          <Button
            onClick={handleLink}
            className="w-full bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-semibold"
            disabled={linking}
          >
            {linking ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <GoogleIcon className="h-4 w-4 mr-2" />
            )}
            Mit Google verknüpfen
          </Button>

          <Button
            variant="ghost"
            onClick={handleSkip}
            className="w-full text-muted-foreground"
          >
            Überspringen
          </Button>
        </div>
      </div>
    </div>
  )
}
