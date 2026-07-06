// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Personen — the daily entry point: "someone walks up with a question."
// One search over people (badge lookup via NFC scan), membership filter
// pills, row → person workspace.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { useCollection } from "@modules/lib/firestore"
import {
  membershipsCollection,
  usersCollection,
} from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { formatFullName } from "@modules/lib/username-utils"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { FilterPills } from "@/components/admin/filter-pills"
import {
  membershipFilterStatus,
  type MembershipFilterStatus,
} from "@/lib/membership-filter"
import { formatDate } from "@modules/lib/format"
import { Avatar } from "@modules/components/ui/avatar"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card } from "@modules/components/ui/card"
import { Input } from "@modules/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import { EmptyState } from "@modules/components/empty-state"
import {
  ChevronRight,
  Loader2,
  Plus,
  ScanLine,
  Search,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { CreateUserDialog } from "@/components/admin/create-user-dialog"
import { useTagScan, type ResolveTagResult } from "@/nfc/use-tag-scan"

type PersonFilter = "all" | MembershipFilterStatus

export const Route = createFileRoute("/_authenticated/users/")({
  component: PeoplePage,
})

const FILTER_LABEL: Record<MembershipFilterStatus, string> = {
  active: "Aktiv",
  expiring: "Läuft ab",
  expired: "Abgelaufen",
  none: "Ohne Mitgliedschaft",
}

function PeoplePage() {
  const db = useDb()
  const navigate = useNavigate()
  const { data: users, loading } = useCollection(usersCollection(db))
  const { data: memberships } = useCollection(membershipsCollection(db))
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<PersonFilter>("all")

  // Web NFC: scan a tag and jump to its owner (Chrome/Android only).
  const { supported: nfcSupported, scanTag } = useTagScan()
  const scanMutation = useAsyncMutation<ResolveTagResult>({
    context: "admin.usersScanTag",
    errorMessage: "Tag konnte nicht gelesen werden",
  })

  const handleScanTag = async () => {
    let result
    try {
      result = await scanMutation.mutate(() => scanTag())
    } catch {
      return
    }
    if (result.registered && result.userId) {
      if (result.deactivated) toast.info("Tag ist deaktiviert.")
      navigate({ to: "/users/$userId", params: { userId: result.userId } })
    } else {
      toast.info(
        "Tag ist keiner Person zugeordnet — auf der Personenseite zuordnen.",
      )
    }
  }

  const nowMs = Date.now()
  const rows = useMemo(() => {
    // Best membership per person: prefer the active one, else the most
    // recent — mirrors the person page.
    const byUser = new Map<
      string,
      { status: string; validUntil: (typeof memberships)[number]["validUntil"] }
    >()
    for (const membership of memberships) {
      for (const memberRef of membership.members ?? []) {
        const existing = byUser.get(memberRef.id)
        if (!existing || membership.status === "active") {
          byUser.set(memberRef.id, membership)
        }
      }
    }
    const needle = search.trim().toLowerCase()
    return users
      .map((user) => ({
        ...user,
        name: formatFullName(user, "–"),
        membershipStatus: membershipFilterStatus(byUser.get(user.id), nowMs),
        validUntil: byUser.get(user.id)?.validUntil,
      }))
      .filter((u) => filter === "all" || u.membershipStatus === filter)
      .filter(
        (u) =>
          !needle ||
          u.name.toLowerCase().includes(needle) ||
          (u.email ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, memberships, search, filter])

  if (loading) return <PageLoading />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Personen"
        action={
          <div className="flex gap-2">
            {nfcSupported && (
              <Button
                variant="secondary"
                onClick={handleScanTag}
                disabled={scanMutation.loading}
              >
                {scanMutation.loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ScanLine className="mr-2 h-4 w-4" />
                )}
                Badge scannen
              </Button>
            )}
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Neue Person
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-80 max-w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Name oder E-Mail …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            autoFocus
          />
        </div>
        <FilterPills<PersonFilter>
          options={[
            { value: "all", label: "Alle" },
            { value: "active", label: FILTER_LABEL.active },
            { value: "expiring", label: FILTER_LABEL.expiring },
            { value: "expired", label: FILTER_LABEL.expired },
            { value: "none", label: FILTER_LABEL.none },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Keine Personen gefunden"
          description="Suche oder Filter anpassen."
        />
      ) : (
        <Card className="px-4 py-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Name</TableHead>
                <TableHead>E-Mail</TableHead>
                <TableHead>Mitgliedschaft</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Avatar name={user.name} seed={user.id} size="sm" />
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/users/$userId"
                      params={{ userId: user.id }}
                      className="font-medium hover:underline"
                    >
                      {user.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.email ?? "–"}
                  </TableCell>
                  <TableCell>
                    <MembershipBadge
                      status={user.membershipStatus}
                      validUntil={user.validUntil}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      to="/users/$userId"
                      params={{ userId: user.id }}
                      aria-label={`${user.name} öffnen`}
                    >
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <div className="text-sm text-muted-foreground">
        {rows.length} von {users.length} Personen
      </div>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function MembershipBadge({
  status,
  validUntil,
}: {
  status: MembershipFilterStatus
  validUntil: { toDate(): Date } | undefined
}) {
  switch (status) {
    case "active":
      return <Badge variant="secondary">aktiv</Badge>
    case "expiring":
      return (
        <Badge className="bg-oww-gold-light text-oww-gold-text border-oww-gold-border">
          läuft ab {validUntil ? formatDate(validUntil) : ""}
        </Badge>
      )
    case "expired":
      return <Badge variant="destructive">abgelaufen</Badge>
    case "none":
      return <Badge variant="outline">keine</Badge>
  }
}
