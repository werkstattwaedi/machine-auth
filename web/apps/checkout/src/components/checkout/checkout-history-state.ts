// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * History state the wizard attaches to `/checkout` navigations from the
 * material step. Reached any other way (a stale-checkout resume, a
 * membership purchase landing there) the summary is about settling what is
 * already in the checkout, so the Vereinsmitgliedschaft section (with its
 * address form) opens by itself. Since issue #605 the Nutzungsgebühren
 * section no longer depends on this (CHK-31: open iff a person has a
 * discounted usage type). History state rather than a search param so the
 * URL stays shareable and reload-stable.
 */
declare module "@tanstack/history" {
  interface HistoryState {
    /** Arrived from the material step ("Zum Checkout"). */
    fromVisit?: boolean
  }
}

export const CHECKOUT_FROM_VISIT_STATE = { fromVisit: true } as const
