// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Test render helpers that wrap components with FirebaseProvider
 * using fakes from the TestFixture builder.
 */

import { render, renderHook, type RenderOptions, type RenderHookOptions } from "@testing-library/react"
import { type ReactElement, type ReactNode } from "react"
import { FirebaseProvider, type FirebaseServices } from "../lib/firebase-context"
import { TestFixture } from "./fixtures"

interface FakeProviderOptions {
  fixture?: TestFixture
  currentUser?: string
}

/**
 * Create a wrapper component that provides Firebase fakes.
 * Use with renderHook or render.
 */
export function createFakeWrapper(options?: FakeProviderOptions) {
  const fixture = options?.fixture ?? new TestFixture()
  const { db, auth } = fixture.buildFake({
    currentUser: options?.currentUser,
  })

  // Cast to FirebaseServices — the fakes implement the subset used by our code
  const services: FirebaseServices = {
    db: db as unknown as FirebaseServices["db"],
    auth: auth as unknown as FirebaseServices["auth"],
    functions: {} as unknown as FirebaseServices["functions"],
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <FirebaseProvider value={services}>{children}</FirebaseProvider>
  }

  return { Wrapper, db, auth }
}

/**
 * Render a React element with Firebase fakes injected.
 */
export function renderWithFake(
  ui: ReactElement,
  options?: FakeProviderOptions & Omit<RenderOptions, "wrapper">,
) {
  const { Wrapper, db, auth } = createFakeWrapper(options)
  const result = render(ui, { ...options, wrapper: Wrapper })
  return { ...result, db, auth }
}

/**
 * Render a hook with Firebase fakes injected.
 */
export function renderHookWithFake<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options?: FakeProviderOptions & Omit<RenderHookOptions<TProps>, "wrapper">,
) {
  const { Wrapper, db, auth } = createFakeWrapper(options)
  const result = renderHook(hook, { ...options, wrapper: Wrapper })
  return { ...result, db, auth }
}
