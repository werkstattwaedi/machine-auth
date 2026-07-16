// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #495 (ported from the old user-detail
 * route test after the profile form moved to the Profil tab): the
 * "Administrator" checkbox must drive the `isAdmin` form value so saving
 * persists `roles: ["admin"]`. Before the fix the Radix Checkbox was
 * bound via `{...register("isAdmin")}` with `checked={undefined}`, so the
 * toggle never reached form state and every save wrote `roles: []` —
 * wiping admin both from the UI and any hand-set Firestore value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup, act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode } from "react"
import type { UserDoc } from "@modules/lib/firestore-entities"

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@modules/lib/firestore-helpers", () => ({
  userRef: (_db: unknown, id: string) => ({ id, path: `users/${id}` }),
}))

vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
}))

const mockUpdate = vi.fn()
vi.mock("@modules/hooks/use-firestore-mutation", () => ({
  useFirestoreMutation: () => ({
    add: vi.fn(),
    update: mockUpdate,
    remove: vi.fn(),
    set: vi.fn(),
    loading: false,
    error: null,
  }),
}))

vi.mock("@modules/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
// The real shadcn/Radix Checkbox emits `onCheckedChange(checked)` (not a
// native `onChange`). Mirror that contract here so the migrated binding
// (`checked` + `onCheckedChange`, issue #495) is actually exercised: a
// dumb prop-spread mock would let a native `onChange` binding pass while
// the real Radix widget stays broken.
vi.mock("@modules/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...rest
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  } & Record<string, unknown>) => (
    <input
      type="checkbox"
      checked={checked ?? false}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
    />
  ),
}))
vi.mock("@modules/components/ui/label", () => ({
  Label: ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => (
    <label {...(rest as React.LabelHTMLAttributes<HTMLLabelElement>)}>{children}</label>
  ),
}))
vi.mock("@modules/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    type?: "submit" | "button"
  }) => (
    <button onClick={onClick} disabled={disabled} type={type ?? "button"}>
      {children}
    </button>
  ),
}))
vi.mock("@modules/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => (
    <input {...(props as React.InputHTMLAttributes<HTMLInputElement>)} />
  ),
}))

const { PersonProfileTab } = await import("./profile-tab")

function testUser(roles: string[], phone: string | null = null): UserDoc {
  return {
    firstName: "Test",
    lastName: "Admin",
    email: "test@example.com",
    phone,
    roles,
    permissions: [],
    userType: "erwachsen",
    termsAcceptedAt: null,
    billingAddress: null,
  } as unknown as UserDoc
}

describe("PersonProfileTab admin role persistence (issue #495)", () => {
  beforeEach(() => {
    mockUpdate.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("toggling the Administrator checkbox saves roles: ['admin']", async () => {
    render(<PersonProfileTab userId="u1" user={testUser([])} />)

    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole("checkbox", { name: /Administrator/ }))
      await user.click(screen.getByRole("button", { name: /Speichern/ }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roles: ["admin"] }),
      expect.anything(),
    )
  })

  it("preserves unknown role values while toggling admin", async () => {
    render(
      <PersonProfileTab userId="u1" user={testUser(["vereinsmitglied"])} />,
    )

    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole("checkbox", { name: /Administrator/ }))
      await user.click(screen.getByRole("button", { name: /Speichern/ }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roles: ["vereinsmitglied", "admin"] }),
      expect.anything(),
    )
  })

  it("saving an existing admin without touching the checkbox preserves roles: ['admin']", async () => {
    render(<PersonProfileTab userId="u1" user={testUser(["admin"])} />)

    const user = userEvent.setup()
    // The checkbox reflects the persisted admin state on load.
    expect(
      (
        screen.getByRole("checkbox", {
          name: /Administrator/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true)

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Speichern/ }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roles: ["admin"] }),
      expect.anything(),
    )
  })
})

/**
 * Regression coverage for issue #554: the admin profile tab used to save
 * the raw free-text phone input (`phone: values.phone || null`), letting an
 * admin edit reintroduce formatted variants like "+41 79 248 94 28" into
 * `users.phone` (which is meant to hold E.164). It now mirrors the checkout
 * profile form: validate through `parseSwissPhone` and store the normalised
 * `e164` result. Uses the real `parseSwissPhone` helper (no mock) so the
 * normalisation is genuinely exercised.
 */
describe("PersonProfileTab phone normalisation (issue #554)", () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("saves a formatted phone as normalised E.164 (not the raw string)", async () => {
    render(<PersonProfileTab userId="u1" user={testUser([])} />)

    const user = userEvent.setup()
    const phone = screen.getByLabelText(/Telefon/) as HTMLInputElement
    await act(async () => {
      await user.clear(phone)
      await user.type(phone, "+41 79 248 94 28")
      await user.click(screen.getByRole("button", { name: /Speichern/ }))
    })

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      // The raw "+41 79 248 94 28" must NOT survive — this assertion fails
      // against the old raw-save code.
      expect.objectContaining({ phone: "+41792489428" }),
      expect.anything(),
    )
  })

  it("rejects an invalid phone: does not save and surfaces the error", async () => {
    render(<PersonProfileTab userId="u1" user={testUser([])} />)

    const user = userEvent.setup()
    const phone = screen.getByLabelText(/Telefon/) as HTMLInputElement
    await act(async () => {
      await user.clear(phone)
      await user.type(phone, "not-a-number")
      await user.click(screen.getByRole("button", { name: /Speichern/ }))
    })

    await waitFor(() =>
      expect(
        screen.getByText(/gültige Schweizer Telefonnummer/),
      ).toBeTruthy(),
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("saves empty phone input as null", async () => {
    render(<PersonProfileTab userId="u1" user={testUser([])} />)

    const user = userEvent.setup()
    await act(async () => {
      // Leave the (empty) phone field untouched and save.
      await user.click(screen.getByRole("button", { name: /Speichern/ }))
    })

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phone: null }),
      expect.anything(),
    )
  })
})
