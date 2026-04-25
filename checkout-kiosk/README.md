# Checkout Kiosk

Electron kiosk app for in-workshop self-checkout using a USB NFC reader.

**Tested readers:** ACS ACR1252 (recommended). The Identiv uTrust 3700 F has reliability issues with READ BINARY on NTAG424 DNA tags.

## Prerequisites

### Linux
```bash
sudo apt install libpcsclite-dev pcscd
```

### macOS
PC/SC is included with macOS (no extra packages needed).

## Setup

```bash
cd checkout-kiosk
npm install          # installs deps + runs electron-rebuild for native modules
```

## Usage

```bash
npm start            # starts the kiosk app
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHECKOUT_URL` | `https://localhost:5173/?kiosk` | Base URL for the checkout web app |
| `KIOSK_BEARER_KEY` | `""` | Per-kiosk Bearer secret. **Required in production** (the app refuses to start without it). The web app passes it as `Authorization: Bearer …` to `/api/verifyTagCheckout`. The dev/emulator path bypasses the check, so an empty value is fine when `CHECKOUT_URL` points at localhost. |

The Bearer is intentionally a soft revocation/audit knob, not real
attestation — anyone with local admin on this Windows box can extract
it. The actual security defense for the kiosk badge flow is the
synthetic-UID custom token returned by `verifyTagCheckout`. See
`docs/Security Analysis.md` for the threat model.

For local development with emulators:
```bash
CHECKOUT_URL=https://localhost:5173/?kiosk npm start
```

For production:
```bash
CHECKOUT_URL=https://checkout.werkstattwaedi.ch/?kiosk \
KIOSK_BEARER_KEY="$(cat /etc/oww-kiosk/bearer.key)" \
  npm start
```

The Bearer should be installed on the kiosk machine outside the
checked-in source tree (e.g., a file owned by root, or a systemd
EnvironmentFile). Rotate the secret with
`firebase functions:secrets:set KIOSK_BEARER_KEY` and update the
kiosk environment to match.

## How It Works

1. Electron window loads the checkout web app in a `<webview>` with `?kiosk` param
2. Top bar has a "Neuer Checkout" button to reset the webview
3. Main process listens for NFC cards via `nfc-pcsc` (PC/SC)
4. On card detect: reads NDEF URL via ISO 7816-4 APDUs, extracts `picc`/`cmac` params
5. Navigates webview to checkout URL with those params
6. The web app handles tag verification, user pre-fill, and checkout flow

## Notes

- Uses `<webview>` tag instead of `<iframe>` to bypass CSP/X-Frame-Options restrictions
- The web app owns all checkout state, timeout, and new-tag confirmation logic
- `electron-rebuild` runs as postinstall to ensure `nfc-pcsc` native bindings match Electron's Node version
