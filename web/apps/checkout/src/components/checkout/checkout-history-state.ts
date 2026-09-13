// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * History state the wizard attaches to `/checkout` navigations. The
 * summary's Nutzungsgebühren section opens by itself when the visitor
 * arrives from the material step (issue #570 — volunteers never found the
 * option in the collapsed section), but stays collapsed when the summary
 * is reached another way (a stale-checkout resume, a membership purchase),
 * where nothing about the visit is new to review. History state rather
 * than a search param so the URL stays shareable and reload-stable.
 */
declare module "@tanstack/history" {
  interface HistoryState {
    /** Open the Nutzungsgebühren section on arrival. */
    expandUsageFees?: boolean
  }
}

export const CHECKOUT_FROM_VISIT_STATE = { expandUsageFees: true } as const
