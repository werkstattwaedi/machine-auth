// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  USER_TYPE_LABELS,
  USAGE_TYPE_LABELS,
  type UserType,
  type UsageType,
} from "@/lib/pricing"
import { formatCHF } from "@/lib/format"
import { Trash2, User } from "lucide-react"
import type { CheckoutPerson, CheckoutAction } from "./use-checkout-state"

interface PersonCardProps {
  person: CheckoutPerson
  index: number
  isOnly: boolean
  showTerms: boolean
  dispatch: React.Dispatch<CheckoutAction>
}

export function PersonCard({
  person,
  index,
  isOnly,
  showTerms,
  dispatch,
}: PersonCardProps) {
  const update = (updates: Partial<CheckoutPerson>) =>
    dispatch({ type: "UPDATE_PERSON", id: person.id, updates })

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <User className="h-4 w-4" />
            {index === 0 ? "Hauptperson" : `Begleitperson ${index}`}
          </div>
          {!isOnly && !person.isPreFilled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                dispatch({ type: "REMOVE_PERSON", id: person.id })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {person.isPreFilled ? (
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Name: </span>
              {person.firstName} {person.lastName}
            </p>
            <p>
              <span className="text-muted-foreground">E-Mail: </span>
              {person.email}
            </p>
            <p>
              <span className="text-muted-foreground">Nutzer:in: </span>
              {USER_TYPE_LABELS[person.userType]}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Vorname *</Label>
              <Input
                value={person.firstName}
                onChange={(e) => update({ firstName: e.target.value })}
                placeholder="Vorname"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nachname *</Label>
              <Input
                value={person.lastName}
                onChange={(e) => update({ lastName: e.target.value })}
                placeholder="Nachname"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">E-Mail *</Label>
              <Input
                type="email"
                value={person.email}
                onChange={(e) => update({ email: e.target.value })}
                placeholder="email@example.com"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Nutzer:in</Label>
              <div className="flex gap-3">
                {(Object.entries(USER_TYPE_LABELS) as [UserType, string][]).map(
                  ([value, label]) => (
                    <label key={value} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name={`userType-${person.id}`}
                        checked={person.userType === value}
                        onChange={() => update({ userType: value })}
                      />
                      {label}
                    </label>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Nutzungsart</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            value={person.usageType}
            onChange={(e) =>
              update({ usageType: e.target.value as UsageType })
            }
          >
            {(
              Object.entries(USAGE_TYPE_LABELS) as [UsageType, string][]
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-muted-foreground">
            Nutzungsgebühr
          </span>
          <span className="font-semibold">{formatCHF(person.fee)}</span>
        </div>

        {showTerms && !person.isPreFilled && (
          <div className="flex items-start gap-2 pt-1">
            <Checkbox
              id={`terms-${person.id}`}
              checked={person.termsAccepted}
              onCheckedChange={(checked) =>
                update({ termsAccepted: checked === true })
              }
            />
            <label htmlFor={`terms-${person.id}`} className="text-xs leading-snug">
              Ich akzeptiere die{" "}
              <a
                href="https://werkstattwaedi.ch/nutzungsbestimmungen"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Nutzungsbestimmungen
              </a>
              {" "}der Offenen Werkstatt Wädenswil. *
            </label>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
