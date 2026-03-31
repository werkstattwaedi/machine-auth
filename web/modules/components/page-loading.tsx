// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Loader2 } from "lucide-react"

export function PageLoading() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}
