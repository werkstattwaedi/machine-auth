# OWW Hardware Bridge (Electron)

Single Electron codebase that produces **two** named binaries:

- **OWW Kiosk** — fullscreen-ish kiosk app, loads the checkout web app,
  volatile session (every restart starts clean).
- **OWW Admin** — normal admin desktop app, loads the admin web app,
  persistent session (admins stay signed in).

Both binaries expose the same `window.bridge.*` IPC API to the loaded
web app — NFC + label printer (issue #313). The mode, target URL,
bearer secret, and printer host are all **baked at build time** by
`scripts/inject-build-config.mjs`; there are no runtime flags or env
vars on the installed host.

**Tested readers:** ACS ACR1252 (recommended). The Identiv uTrust 3700 F
has reliability issues with READ BINARY on NTAG424 DNA tags.

## Prerequisites

### Linux
```bash
sudo apt install libpcsclite-dev pcscd
```

### macOS / Windows
PC/SC is included with the OS (no extra packages needed).

## Setup

```bash
cd checkout-kiosk
npm install          # installs deps + runs electron-rebuild for nfc-pcsc
```

## Dev

```bash
npm run start:kiosk     # injects BRIDGE_MODE=kiosk, compiles, launches
npm run start:admin     # injects BRIDGE_MODE=admin, compiles, launches
```

`start:kiosk` defaults to `https://localhost:5173/?kiosk`,
`start:admin` to `https://localhost:5174/`. Override per-env via
`BRIDGE_KIOSK_URL` / `BRIDGE_ADMIN_URL`. See [Build-time
Configuration](#build-time-configuration) for the full env-var list.

## Packaging

```bash
npm run build:kiosk     # → release/kiosk/oww-kiosk-<ver>-setup.exe (et al.)
npm run build:admin     # → release/admin/oww-admin-<ver>-setup.exe (et al.)
```

Per-mode electron-builder configs:
- `electron-builder.kiosk.yml`
- `electron-builder.admin.yml`

Cross-compiling for Windows from Linux works through Wine (see the
electron-builder docs); the recommended path is to run the Windows build
on a Windows machine or Windows CI runner.

## Build-time Configuration

All settings are **baked into the binary at build time** by
`scripts/inject-build-config.mjs` (one kiosk and one admin host in
production; managing per-host env vars is more painful than reshipping
a self-contained binary). The script reads env vars on the build host
and writes `src/build-config.generated.ts`, which the runtime imports
as plain constants.

| Variable | Default | Used by | Description |
|----------|---------|---------|-------------|
| `BRIDGE_MODE` | _(required)_ | inject script | `kiosk` or `admin`. Set automatically by `npm run build:kiosk` / `build:admin` / `dev:kiosk` / `dev:admin`. |
| `BRIDGE_KIOSK_URL` | `https://localhost:5173/?kiosk` | kiosk builds | Base URL for the checkout web app. |
| `BRIDGE_ADMIN_URL` | `https://localhost:5174/` | admin builds | Base URL for the admin web app. |
| `BRIDGE_BEARER_KEY` | `""` | both | Per-build Bearer secret. **The build fails** when the URL points at a non-localhost host and this is empty. Web app sends it as `Authorization: Bearer …` to backend endpoints that decode the tag (`/api/verifyTagCheckout` today). The dev/emulator path bypasses the check, so empty is fine on localhost. |
| `BRIDGE_PRINTER_HOST` | _(unset)_ | admin builds (today) | `host[:port]` of a Brother PT-P950NW on the LAN (e.g. `labeler.internal:9100`). When set, the bridge advertises the `"print"` feature and forwards `window.bridge.print(bytes)` over TCP. Unset → admin "Etikett drucken" buttons stay hidden. Defaults to port 9100 when no port given. |

The Bearer is a soft revocation/audit knob, not real attestation — anyone
with local admin on this machine can extract it. The actual security
defense for the kiosk badge flow is the synthetic-UID custom token
returned by `verifyTagCheckout`. See `docs/Security Analysis.md` for the
threat model.

### Production builds (`--prod`)

```bash
npm run build:kiosk:prod    # → release/kiosk/oww-kiosk-<ver>-…
npm run build:admin:prod    # → release/admin/oww-admin-<ver>-…
```

The `:prod` scripts pass `--prod` to `inject-build-config.mjs`, which:

* Reads URLs + printer host from the operations repo
  (`../machine-auth-operations/config.jsonc`, same file
  `scripts/generate-env.ts` reads — keeps Electron + web apps +
  Cloud Functions in sync). Override the location with
  `OPERATIONS_CONFIG_DIR`.
* Fetches the bearer from Google Secret Manager
  (`gcloud secrets versions access latest --secret=KIOSK_BEARER_KEY`)
  — same secret Cloud Functions reads server-side. Requires `gcloud`
  authenticated against the OWW project.

Any explicit env var still wins, so you can override single values
without losing the rest:

```bash
# Build a kiosk binary pointing at the staging URL but using prod bearer:
BRIDGE_KIOSK_URL=https://checkout.staging.werkstattwaedi.ch/?kiosk \
  npm run build:kiosk:prod
```

#### Required keys in the operations config

```jsonc
{
  "web": {
    "checkoutDomain": "checkout.werkstattwaedi.ch",   // already present
    "adminDomain":    "admin.werkstattwaedi.ch"       // NEW for --prod admin builds
  },
  "electron": {
    "printerHost":    "labeler.internal:9100"         // NEW for --prod admin builds
  }
}
```

Kiosk builds only need `web.checkoutDomain`; admin builds also need
`web.adminDomain` + `electron.printerHost`. The script fails the build
with a clear error if any required key is missing.

The bearer secret is baked into the JavaScript bundle, so the
`.AppImage` / installer is itself confidential. Build on a trusted
host (e.g. your laptop) and hand-carry the installer to the kiosk /
admin workstation. **Rotating the bearer = rebuild + reinstall.**
Server-side rotation lives at `firebase functions:secrets:set
KIOSK_BEARER_KEY` (same secret name on both sides).

## How It Works

1. Electron creates a `BrowserWindow` with a `<webview>` that loads the
   configured URL (`BRIDGE_KIOSK_URL` or `BRIDGE_ADMIN_URL`).
2. Both the chrome window and the webview load `dist/preload.js`, which
   exposes `window.bridge.*` (mode, features, bearer, resetSession,
   getUrl, onUrlChange, onNfcTag).
3. The main process owns the NFC reader (`nfc-pcsc`), reads tags via
   ISO 7816-4 APDUs, and broadcasts `{ physicalUid, url? }` events to
   every subscribed webContents.
4. The loaded **web app** (inside the webview) handles tag navigation —
   it parses `picc`/`cmac` from the NDEF URL and routes accordingly.
   This issue refactors away the renderer's old `webview.src = …`
   navigation path; navigation is now client-side and React-aware.

## File Layout

```
src/
├── main.ts                       Main process entry (Electron lifecycle, IPC)
├── preload.ts                    Exposes window.bridge to renderer + webview
├── config.ts                     Mode/URL/window resolver (pure function)
├── build-config.generated.ts     Build-injected constants (mode + URL + bearer + printer)
├── bridge/
│   ├── nfc.ts                    nfc-pcsc wrapper, APDU + NDEF parsing
│   └── printer.ts                TCP forwarder to Brother PT-P950NW
├── types.ts                      Shared Bridge / NfcTagEvent types
└── renderer/
    ├── renderer.ts               Chrome script (creates webview, wires reset)
    └── tsconfig.json             ESM/DOM target (separate from main tsconfig)

renderer/
├── index.html                    Chrome HTML (loads dist/renderer/renderer.js)
└── styles.css                    Chrome CSS

scripts/
└── inject-build-config.mjs       Writes src/build-config.generated.ts before each build
```

## Notes

- The web app's `window.bridge` is **only** available when the page is
  loaded inside this Electron build. Open the same URL in a regular
  Chrome tab and `window.bridge` is undefined — the web app falls back
  to manual UI (no hardware affordances).
- `electron-rebuild` runs as postinstall to match `nfc-pcsc` native
  bindings to Electron's Node ABI.
- Webview is used (not `<iframe>`) so we can bypass CSP/X-Frame-Options
  and attach a preload script with `window.bridge`.
