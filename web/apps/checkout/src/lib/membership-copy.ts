// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The one member benefit membership copy promises: a discount on machine
 * usage. Member pricing is a per-variant catalog field and isn't actually
 * restricted to machine items in the data model, so this constant scopes
 * the *marketing promise*, not a pricing-engine guarantee — every place
 * that advertises the membership must promise exactly this and nothing
 * more — the status hero, the purchase cards and the family invite page
 * all read from here (issue #665).
 */
export const MEMBER_DISCOUNT_BENEFIT = "Vergünstigungen bei der Maschinennutzung"
