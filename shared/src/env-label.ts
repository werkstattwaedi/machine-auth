// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Prefix a surface title (browser tab, kiosk window, tray tooltip) with
 * the deployment label from the operations config (`web.envLabel`), so
 * staging and local builds are recognisable at a glance. Production
 * leaves the label empty, which returns `title` unchanged.
 */
export function withEnvLabel(
  label: string | undefined | null,
  title: string
): string {
  const trimmed = (label ?? "").trim()
  return trimmed ? `${trimmed} ${title}` : title
}
