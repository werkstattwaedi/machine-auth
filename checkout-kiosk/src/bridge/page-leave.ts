// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// A terminal payment belongs to the page that started it. When that page
// goes away — destroyed, its renderer crashed, or it navigated to another
// document (a reload included) — nobody is left to present a card, and an
// armed terminal would answer the next person's payment with "busy" until
// it times out (ADR-0051).

/** The slice of Electron's WebContents this needs; tests pass a fake. */
export interface PageEvents {
  on(event: "did-start-navigation", listener: (details: NavigationDetails) => void): unknown
  on(event: "render-process-gone" | "destroyed", listener: () => void): unknown
  removeListener(event: string, listener: (...args: never[]) => void): unknown
  isDestroyed(): boolean
}

export interface NavigationDetails {
  isMainFrame: boolean
  isSameDocument: boolean
}

/**
 * Calls `onLeave` once when the page leaves; the returned function stops
 * watching. In-page route changes (history API, hash) are not leaving.
 */
export function watchPageLeave(page: PageEvents, onLeave: () => void): () => void {
  let left = false
  const leave = () => {
    if (left) return
    left = true
    onLeave()
  }
  const onNavigation = (details: NavigationDetails) => {
    if (details.isMainFrame && !details.isSameDocument) leave()
  }
  page.on("destroyed", leave)
  page.on("render-process-gone", leave)
  page.on("did-start-navigation", onNavigation)
  return () => {
    if (page.isDestroyed()) return
    page.removeListener("destroyed", leave)
    page.removeListener("render-process-gone", leave)
    page.removeListener("did-start-navigation", onNavigation)
  }
}
