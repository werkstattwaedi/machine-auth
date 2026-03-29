// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * In-memory Firebase Auth fake for unit tests.
 *
 * Supports the minimal subset needed by AuthProvider:
 * - onAuthStateChanged listener
 * - setCurrentUser() to simulate sign-in/out
 */

export interface FakeUser {
  uid: string
  email: string | null
  displayName: string | null
  getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }>
  getIdToken: (forceRefresh?: boolean) => Promise<string>
}

type AuthStateCallback = (user: FakeUser | null) => void

export class FakeAuth {
  private user: FakeUser | null = null
  private listeners = new Set<AuthStateCallback>()

  /** Register an auth state listener. Fires immediately with current user. */
  onAuthStateChanged(callback: AuthStateCallback): () => void {
    this.listeners.add(callback)
    // Fire immediately like real Firebase Auth
    callback(this.user)
    return () => {
      this.listeners.delete(callback)
    }
  }

  /** Simulate sign-in or sign-out. Fires all listeners. */
  setCurrentUser(user: FakeUser | null) {
    this.user = user
    for (const cb of this.listeners) {
      cb(this.user)
    }
  }

  /** Get current user (for assertions) */
  get currentUser(): FakeUser | null {
    return this.user
  }
}

/** Create a minimal FakeUser for tests */
export function createFakeUser(overrides: {
  uid: string
  email?: string
  displayName?: string
  claims?: Record<string, unknown>
}): FakeUser {
  const claims = overrides.claims ?? {}
  return {
    uid: overrides.uid,
    email: overrides.email ?? `${overrides.uid}@test.com`,
    displayName: overrides.displayName ?? overrides.uid,
    getIdTokenResult: async () => ({ claims }),
    getIdToken: async () => "fake-token",
  }
}
