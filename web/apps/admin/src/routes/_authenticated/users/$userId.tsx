// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Person workspace — every admin task around one person on one screen.
// Person-scoped concerns live in tabs (deep-linkable via ?tab=); shared
// ledgers (Rechnungen, Besuche, Nutzungen) are navigated OUT into with a
// person filter pre-applied, never duplicated here.

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useDocument, useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import { membershipsCollection, userRef } from "@modules/lib/firestore-helpers"
import { where } from "firebase/firestore"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { formatFullName } from "@modules/lib/username-utils"
import { Avatar } from "@modules/components/ui/avatar"
import { Badge } from "@modules/components/ui/badge"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@modules/components/ui/tabs"
import { PersonOverviewTab } from "@/components/person/overview-tab"
import { PersonProfileTab } from "@/components/person/profile-tab"
import { PersonMembershipTab } from "@/components/person/membership-tab"
import { PersonBadgesTab } from "@/components/person/badges-tab"
import { PersonPermissionsTab } from "@/components/person/permissions-tab"

const TABS = [
  "overview",
  "profile",
  "membership",
  "badges",
  "permissions",
] as const
export type PersonTab = (typeof TABS)[number]

interface PersonSearch {
  tab?: Exclude<PersonTab, "overview">
}

export const Route = createFileRoute("/_authenticated/users/$userId")({
  validateSearch: (search: Record<string, unknown>): PersonSearch => ({
    tab:
      typeof search.tab === "string" &&
      (TABS as readonly string[]).includes(search.tab) &&
      search.tab !== "overview"
        ? (search.tab as PersonSearch["tab"])
        : undefined,
  }),
  component: PersonPage,
})

function PersonPage() {
  const { userId } = Route.useParams()
  const { tab } = Route.useSearch()
  // Keyed so a person→person navigation remounts ALL hooks: useCollection
  // only re-subscribes on collection-path changes, not on changed where()
  // constraints (same convention as the keyed ledger tables).
  return <PersonWorkspace key={userId} userId={userId} tab={tab} />
}

function PersonWorkspace({
  userId,
  tab,
}: {
  userId: string
  tab: PersonSearch["tab"]
}) {
  const db = useDb()
  const navigate = useNavigate()
  const { data: user, loading } = useDocument(userRef(db, userId))
  // Any membership this person belongs to — including expired/cancelled
  // ones the `activeMembership` denorm no longer points at.
  const { data: memberships } = useCollection(
    membershipsCollection(db),
    where("members", "array-contains", userRef(db, userId)),
  )

  if (loading) return <PageLoading />
  if (!user) return <div>Person nicht gefunden.</div>

  const membership =
    memberships.find((m) => m.status === "active") ??
    [...memberships].sort(
      (a, b) => (b.created?.toMillis() ?? 0) - (a.created?.toMillis() ?? 0),
    )[0] ??
    null

  const activeTab: PersonTab = tab ?? "overview"
  const name = formatFullName(user, "Person")

  return (
    <div className="space-y-4">
      <PageHeader title={name} backTo="/users" backLabel="Zurück zu Personen" />

      <div className="-mt-4 flex flex-wrap items-center gap-2">
        <Avatar name={name} seed={userId} size="sm" />
        {membership?.status === "active" ? (
          <Badge variant="secondary">
            {membership.type === "family" ? "Familienmitgliedschaft" : "Einzelmitgliedschaft"}
          </Badge>
        ) : (
          <Badge variant="outline">kein Mitglied</Badge>
        )}
        {user.roles?.includes("admin") && <Badge>Admin</Badge>}
        <span className="text-sm text-muted-foreground">
          {user.email ?? "keine E-Mail"}
          {user.phone ? ` · ${user.phone}` : ""}
        </span>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          navigate({
            to: "/users/$userId",
            params: { userId },
            search: {
              tab: value === "overview" ? undefined : (value as PersonSearch["tab"]),
            },
          })
        }
      >
        <TabsList>
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="membership">Mitgliedschaft</TabsTrigger>
          <TabsTrigger value="badges">Badges</TabsTrigger>
          <TabsTrigger value="permissions">Berechtigungen</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <PersonOverviewTab userId={userId} user={user} membership={membership} />
        </TabsContent>
        <TabsContent value="profile">
          <PersonProfileTab userId={userId} user={user} />
        </TabsContent>
        <TabsContent value="membership">
          <PersonMembershipTab userId={userId} user={user} membership={membership} />
        </TabsContent>
        <TabsContent value="badges">
          <PersonBadgesTab userId={userId} />
        </TabsContent>
        <TabsContent value="permissions">
          <PersonPermissionsTab userId={userId} user={user} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
