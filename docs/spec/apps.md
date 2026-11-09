# Web apps

What holds for both web apps alike: which version of them runs, the hint
that a new one is deployed, and the minimum version below which an app can't
be used. What the apps do is in [checkout.md](checkout.md) (CHK),
[kiosk.md](kiosk.md) (KIO) and [admin.md](admin.md) (ADM). Terms: see the
[glossary](README.md#glossary).

## New versions

- **APP-1** A web app checks the deployed version when it starts, when its tab becomes visible again and every 15 min, and while the deployed version differs from the one it runs, it shows — except at the kiosk — a hint that a new version is available with a button that reloads it onto the deployed version, without keeping the person from going on. — #845
- **APP-2** While a web app is older than the minimum version, it can't be used: it shows a screen that asks for a reload, and reloads by itself once the deployed version is at least the minimum version. — #845
- **APP-3** The server refuses the function calls of a web app that reports a version older than the minimum version; a call that reports no version is not refused. — #845

## Open questions

- [NEEDS CLARIFICATION] At the kiosk, the reload onto the minimum version (APP-2) is not a reset (KIO-8): whether the person stays signed in and whether what they entered is kept is not decided. — #845

## Retired

<!-- `- APP-n — <PR that retired it>` -->
