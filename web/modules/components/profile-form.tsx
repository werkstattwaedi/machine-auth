// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Shared layout primitives for profile-style forms (Profil page +
 * Komplett-Profil-Onboarding). Extracted so the visual contract — the
 * soft section divider and the small uppercase eyebrow with a leading
 * icon — stays in one place as more profile-shaped surfaces are added
 * (e.g. admin user editor).
 */

import type { ReactNode } from "react"

export function SectionDivider() {
  return <hr className="border-t border-black/10" />
}

export function SectionEyebrow({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="-mt-1 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      {icon}
      {children}
    </div>
  )
}
