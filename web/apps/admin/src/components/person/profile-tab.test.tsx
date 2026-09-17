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
  useFunctions: () => ({}),
}))

// The e-mail goes through the `updateUserEmail` callable (ADR-0043), never
// through the Firestore update. `mockRpcCallable` records (group, method).
const mockUpdateUserEmail = vi.fn()
const mockRpcCallable = vi.fn(() => mockUpdateUserEmail)
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable: (...args: unknown[]) =>
    (mockRpcCallable as (...a: unknown[]) => unknown)(...args),
}))
// The real hook toasts and re-throws (ADR-0025); only the re-throw matters
// to the form, so the mock just runs the function.
vi.mock("@modules/hooks/use-async-mutation", () => ({
  useAsyncMutation: () => ({
    mutate: (fn: () => Promise<unknown>) => fn(),
    loading: false,
    error: null,
    reset: vi.fn(),
  }),
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

/**
 * Issue #633 / ADR-0043: `users.email` is the login identity. A doc-only
 * edit left Firebase Auth on the old address, so the member's next code
 * sign-in with the new one minted a second, doc-less account. The form now
 * routes an e-mail change through the `updateUserEmail` callable (Auth +
 * doc together) and never includes `email` in its Firestore update.
 */
describe("PersonProfileTab e-mail change (issue #633)", () => {
  beforeEach(() => {
    mockUpdate.mockReset()
    mockUpdate.mockResolvedValue(undefined)
    mockUpdateUserEmail.mockReset()
    mockUpdateUserEmail.mockResolvedValue({ data: {} })
    mockRpcCallable.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  async function changeEmailAndSave(value: string) {
    const user = userEvent.setup()
    const email = screen.getByLabelText(/E-Mail/) as HTMLInputElement
    await act(async () => {
      await user.clear(email)
      if (value) await user.type(email, value)
      await user.click(screen.getByRole("button", { name: /Speichern/ }))
    })
  }

  it("sends a changed e-mail through the RPC, not the Firestore update", async () => {
    render(<PersonProfileTab userId="u1" user={testUser([])} />)

    await changeEmailAndSave("New@Example.com")

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockRpcCallable).toHaveBeenCalledWith(
      expect.anything(),
      "authCall",
      "updateUserEmail",
    )
    expect(mockUpdateUserEmail).toHaveBeenCalledWith({
      uid: "u1",
      email: "new@example.com",
    })
    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty("email")
  })

  it("skips the RPC when the e-mail is unchanged", async () => {
    render(<PersonProfileTab userId="u1" user={testUser([])} />)

    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Speichern/ }))
    })

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdateUserEmail).not.toHaveBeenCalled()
    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty("email")
  })

  it("moves no other field when the e-mail change is refused", async () => {
    mockUpdateUserEmail.mockRejectedValue(
      Object.assign(new Error("in use"), { code: "functions/already-exists" }),
    )
    render(<PersonProfileTab userId="u1" user={testUser([])} />)

    await changeEmailAndSave("taken@example.com")

    await waitFor(() => expect(mockUpdateUserEmail).toHaveBeenCalledTimes(1))
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects a malformed e-mail before calling the RPC", async () => {
    render(<PersonProfileTab userId="u1" user={testUser([])} />)

    // Passes the browser's lenient type=email check, fails ours (no TLD).
    await changeEmailAndSave("someone@localhost")

    await waitFor(() =>
      expect(screen.getByText(/gültige E-Mail-Adresse/)).toBeTruthy(),
    )
    expect(mockUpdateUserEmail).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("refuses to remove an existing login e-mail", async () => {
    render(<PersonProfileTab userId="u1" user={testUser([])} />)

    await changeEmailAndSave("")

    await waitFor(() =>
      expect(screen.getByText(/nicht entfernt werden/)).toBeTruthy(),
    )
    expect(mockUpdateUserEmail).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
