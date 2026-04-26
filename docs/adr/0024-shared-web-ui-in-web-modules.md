# ADR-0024: Shared web UI lives in web/modules

**Status:** Accepted

**Date:** 2026-04-26

## Context

Two web SPAs (`web/apps/admin`, `web/apps/checkout`) duplicated several
near-identical files: `_authenticated.tsx` layouts, `login.tsx`,
`login_.verify.tsx`, `link-account.tsx`, and the `data-table/` directory.
The `web/modules/` workspace already exists for shared code (Firebase
context, hooks, UI primitives), but app-specific copies kept being added.

A launch-readiness audit (issue #146 / finding A4) flagged ~600 lines of
forked code, with the risk that bug fixes and behaviour changes drift
between the two apps.

## Decision

`web/modules/` is the canonical home for cross-app web UI. New shared
components for both SPAs go there; differences are parameterised via
props rather than copied via fork.

Items consolidated in this round:

- `data-table/` moved to `web/modules/components/data-table/`.
- `<AuthenticatedLayout>` in `web/modules/components/authenticated-layout.tsx`
  with parameterised nav items, gate (admin vs member-with-profile-completion),
  and optional wrapper (admin needs `LookupProvider`).
- `<LoginPage>`, `<LoginVerifyPage>`, `<LinkAccountPage>` in
  `web/modules/components/auth/`. Differences (default redirect, signup
  flow, branding subtitle, Google-button position) are props.

Each app's route file is now a thin wrapper that supplies its config and
mounts the shared component under TanStack's typed router.

### Dependency boundary

`web/modules/` declares no `package.json` dependencies of its own. It
relies on workspace hoisting from the consuming apps. When a shared
component imports a package that only one consumer has installed (e.g.
`@tanstack/react-table` for `data-table/`), the *other* consumer must
add the dep to its own `package.json` before adopting the component.

### TypeScript navigate quirk

TanStack Router's `useNavigate()` is typed against the registered router
of the importing app. When a shared component navigates to a path that
exists in only one of the two apps (e.g. checkout's `/complete-profile`),
the call is cast to a permissive shape. Runtime correctness is enforced
by the gate guard — admin's `gate.kind === "admin"` never reaches the
`/complete-profile` branch.

## Consequences

**Pros:**
- Single source of truth for the chrome and auth flows; one place to fix
  React-hook ordering bugs (see issue #107 regression test).
- Clear extension pattern: differences in props, not copies.
- Faster onboarding — devs find shared components in one place.

**Cons:**
- Hoisted-dep contract is implicit; a new consumer must add its own
  package.json entry when adopting a shared component that pulls in a
  module-only-imported package.
- Typed `navigate({ to: ... })` calls in shared code lose route
  type-checking when the destination is supplied as a prop.

**Tradeoffs:**
- **Profile forms** were left forked in this pass. The three versions
  (admin user-detail, checkout profile, checkout complete-profile) use
  different shadcn/raw-input styling and validation framing. Lifting
  them is a design exercise that deserves its own PR.
- **Move package deps to modules' own `package.json`.** Considered but
  deferred — would require declaring React, Firebase, lucide-react,
  TanStack Router etc. as `peerDependencies`, which is bookkeeping with
  no runtime benefit while modules is internal.
