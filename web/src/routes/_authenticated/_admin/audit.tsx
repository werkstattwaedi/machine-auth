// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/admin/page-header"
import { AuditLogPanel } from "@/components/admin/audit-log-panel"
import { Card, CardContent } from "@/components/ui/card"

export const Route = createFileRoute("/_authenticated/_admin/audit")({
  component: AuditPage,
})

function AuditPage() {
  return (
    <div>
      <PageHeader title="Audit Log" />
      <Card>
        <CardContent className="pt-6">
          <AuditLogPanel maxEntries={100} />
        </CardContent>
      </Card>
    </div>
  )
}
