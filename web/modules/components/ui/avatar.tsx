// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const avatarVariants = cva(
  "inline-flex items-center justify-center rounded-full font-heading font-bold text-white select-none shrink-0",
  {
    variants: {
      size: {
        sm: "size-7 text-xs",
        default: "size-9 text-sm",
        lg: "size-12 text-base",
      },
    },
    defaultVariants: { size: "default" },
  },
)

const PALETTE = [
  "var(--color-cog-teal-dark)",
  "var(--color-oww-gold-dark)",
  "#7a5cb5",
  "#cf6e3a",
] as const

function initials(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return "?"
  return tokens
    .slice(0, 2)
    .map((t) => t[0])
    .join("")
    .toUpperCase()
}

// FNV-1a 32-bit hash — small, deterministic, no deps.
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export interface AvatarProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof avatarVariants> {
  /** Display name; the first letters of up to two tokens form the initials. */
  name: string
  /** Stable seed for color (e.g. user ID). Falls back to `name`. */
  seed?: string
}

function Avatar({ name, seed, size, className, style, ...rest }: AvatarProps) {
  const colorSeed = seed ?? name
  const color = PALETTE[hash(colorSeed) % PALETTE.length]
  return (
    <span
      role="img"
      aria-label={name}
      data-slot="avatar"
      className={cn(avatarVariants({ size }), className)}
      style={{ background: color, ...style }}
      {...rest}
    >
      {initials(name)}
    </span>
  )
}

export { Avatar, avatarVariants }
