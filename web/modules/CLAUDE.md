# web/modules — shared web UI

This workspace holds code shared between `web/apps/admin` and
`web/apps/checkout`. Both SPAs import from `@modules/...`.

**Use this directory for any new cross-app UI** instead of copying files
between `apps/admin/src/components/` and `apps/checkout/src/components/`.
See [ADR-0023](../../docs/adr/0023-shared-web-ui-in-web-modules.md).

## Structure

| Path                                | Contents                                  |
|-------------------------------------|-------------------------------------------|
| `lib/`                              | Firebase context, auth, lookup, helpers   |
| `hooks/`                            | Shared React hooks                        |
| `components/ui/`                    | shadcn primitives                         |
| `components/auth/`                  | Login, magic-link verify, link-account    |
| `components/data-table/`            | TanStack-react-table wrapper              |
| `components/authenticated-layout.tsx` | Sidebar+main shell with auth gates      |
| `components/icons/`                 | Brand icons not in lucide-react           |
| `test/`                             | Test fixtures, fakes, emulator helpers    |

## Testing

Module unit tests run through the **checkout** app's vitest config —
`apps/checkout/vitest.config.ts` includes `../../modules/**/*.test.{ts,tsx}`.
Browser tests run through `apps/checkout/vitest.browser.config.ts`
(`*.browser.test.tsx`). The admin app does not include modules tests.

## Dependency boundary

This workspace has no `package.json` dependencies of its own — it relies
on workspace hoisting from the consuming app(s). When a shared component
imports a package that only one consumer has installed (e.g.
`@tanstack/react-table` for `data-table/`), the **other** consumer must
add the dep to its own `package.json` before importing the shared
component.

## Typed router caveat

TanStack Router's `useNavigate()` is typed against the importing app's
registered router. When a shared component navigates to a path supplied
as a prop, type-check it with a permissive cast and rely on the
calling app to wire the right path. See `authenticated-layout.tsx` for
the pattern.
