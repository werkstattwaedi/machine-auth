// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { BookOpen } from "lucide-react"
import type { AppMenuEntry } from "@modules/components/app-header/app-menu"

// Bare host, not www.: the kiosk overlay allowlist matches the exact origin
// https://werkstattwaedi.ch, and Squarespace redirects it to www. itself.
export const HELP_URL = "https://werkstattwaedi.ch/checkout-anleitung"
export const WHATS_NEW_URL = "https://werkstattwaedi.ch/checkout-was-ist-neu"

/** "Anleitung" in every checkout menu, next to "Problem melden". */
export const HELP_MENU_ENTRY: AppMenuEntry = {
  label: "Anleitung",
  icon: BookOpen,
  href: HELP_URL,
}
