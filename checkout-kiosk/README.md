# OWW Checkout Kiosk (Electron)

Electron hardware bridge that runs the **OWW Kiosk** binary: a
fullscreen-ish kiosk app that loads the checkout web app with a volatile
session (every restart starts clean).

It exposes a `window.bridge.*` IPC API to the loaded web app for NFC tag
reads. (Label printing does not go through Electron: the admin web app
enqueues a `printJobs` Firestore doc and the on-LAN `maco_gateway` drives
the printer — see the printing-via-gateway plan. Admin tag association
likewise runs in the browser now via Web NFC — the admin Electron build
was retired.) The target URL and bearer secret are **baked at build
time** by `scripts/inject-build-config.mjs`; there are no runtime flags
or env vars on the installed host.

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
npm run start:kiosk     # compiles, launches
```

Defaults to `https://localhost:5173/?kiosk`. Override via
`BRIDGE_KIOSK_URL`. See [Build-time Configuration](#build-time-configuration)
for the full env-var list.

## Packaging

```bash
npm run build:kiosk     # → release/kiosk/oww-kiosk-<ver>-setup.exe (et al.)
```

electron-builder config: `electron-builder.kiosk.yml`.

Cross-compiling for Windows from Linux works through Wine (see the
electron-builder docs); the recommended path is to run the Windows build
on a Windows machine or Windows CI runner.

## Build-time Configuration

All settings are **baked into the binary at build time** by
`scripts/inject-build-config.mjs` (one kiosk host in production; managing
per-host env vars is more painful than reshipping a self-contained
binary). The script reads env vars on the build host and writes
`src/build-config.generated.ts`, which the runtime imports as plain
constants.

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_KIOSK_URL` | `https://localhost:5173/?kiosk` | Base URL for the checkout web app. |
| `BRIDGE_BEARER_KEY` | `""` | Per-build Bearer secret. **The build fails** when the URL points at a non-localhost host and this is empty. The web app includes it in the `authCall/verifyTagCheckout` callable payload to decode the tag. The dev/emulator path bypasses the check, so empty is fine on localhost. |

Label printing is handled by the `maco_gateway` (printer host configured
there), not this bridge — see the printing-via-gateway plan and
`scripts/deploy-gateway.ts`.

The Bearer is a soft revocation/audit knob, not real attestation — anyone
with local admin on this machine can extract it. The actual security
defense for the kiosk badge flow is the synthetic-UID custom token
returned by `verifyTagCheckout`. See `docs/Security Analysis.md` for the
threat model.

### Versioning

Bump the `version` field in `checkout-kiosk/package.json` **once per change you
ship** (semver — `1.0.1`, `1.0.2`, …). That single field is the source of truth:
electron-builder names the installer `oww-kiosk-<version>-setup.exe`, stamps the
NSIS product version, and it's what `app.getVersion()` returns (shown in the
tray/taskbar tooltip). Forget to bump it and every build overwrites the same
`oww-kiosk-1.0.0-setup.exe` — impossible to tell apart. Delete stale
`release/kiosk/oww-kiosk-*-setup.exe` from older versions when they pile up.

### Production builds (`--prod`)

```bash
npm run build:kiosk:prod    # → release/kiosk/oww-kiosk-<ver>-setup.exe
```

The `:prod` script always targets a **Windows x64 NSIS installer**
(`--win` flag to electron-builder) because the OWW kiosk host runs
Windows. Cross-compiling from Linux requires Wine
(`sudo apt install wine64` on WSL2 / Debian); the dev script
(`build:kiosk` without `:prod`) builds for the host platform (AppImage on
Linux, .dmg on macOS) if you just want to smoke-test locally.

The `:prod` script passes `--prod` to `inject-build-config.mjs`, which:

* Reads the URL from the operations repo
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
    "checkoutDomain": "checkout.werkstattwaedi.ch"   // already present
  }
}
```

The script fails the build with a clear error if `web.checkoutDomain` is
missing. (The label printer host now lives in the gateway config, not
here.)

The bearer secret is baked into the JavaScript bundle, so the
`.AppImage` / installer is itself confidential. Build on a trusted
host (e.g. your laptop) and hand-carry the installer to the kiosk.
**Rotating the bearer = rebuild + reinstall.** Server-side rotation lives
at `firebase functions:secrets:set KIOSK_BEARER_KEY` (same secret name on
both sides).

## How It Works

1. Electron creates a `BrowserWindow` with a `<webview>` that loads the
   configured URL (`BRIDGE_KIOSK_URL`).
2. Both the chrome window and the webview load `dist/preload.js`, which
   exposes `window.bridge.*` (mode, features, bearer, resetSession,
   getUrl, onUrlChange, onNfcTag).
3. The main process owns the NFC reader (`nfc-pcsc`), reads tags via
   ISO 7816-4 APDUs, and broadcasts `{ physicalUid, url? }` events to
   every subscribed webContents.
4. The loaded **web app** (inside the webview) handles tag navigation —
   it parses `picc`/`cmac` from the NDEF URL and routes accordingly.

## File Layout

```
src/
├── main.ts                       Main process entry (Electron lifecycle, IPC)
├── preload.ts                    Exposes window.bridge to renderer + webview
├── config.ts                     URL/window resolver (pure function)
├── build-config.generated.ts     Build-injected constants (URL + bearer)
├── bridge/
│   └── nfc.ts                    nfc-pcsc wrapper, APDU + NDEF parsing
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
```
