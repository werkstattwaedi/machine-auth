// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  type WebContents,
} from "electron"
import path from "node:path"
import { resolveConfig } from "./config"
import { startNfc } from "./bridge/nfc"
import { sendToPrinter } from "./bridge/printer"
import type { NfcTagEvent } from "./types"

const config = resolveConfig()

// Accept self-signed certs in dev (Vite basicSsl plugin)
if (config.isDev) {
  app.commandLine.appendSwitch("ignore-certificate-errors")
}

// Per-mode session. Kiosk uses a volatile, wipeable partition so a closed
// kiosk window equals a closed session; admin uses a persistent partition so
// admins stay signed in across restarts.
async function clearSession(): Promise<void> {
  try {
    const sess = session.fromPartition(config.partition)
    await sess.clearStorageData()
    await sess.clearCache()
    console.log(`Session cleared (${config.partition})`)
  } catch (err) {
    console.error(
      "Failed to clear session:",
      err instanceof Error ? err.message : err
    )
  }
}

let mainWindow: BrowserWindow | null = null

// Hand a URL off to the OS default browser/PDF viewer. Gated to `https:`
// only: `shell.openExternal` can launch arbitrary OS handlers, so a
// compromised page must not be able to pop `file:`/custom-scheme URLs.
// Signed Cloud Storage URLs (and any legitimate off-origin link) are always
// https.
function openExternalIfSafe(url: string): void {
  try {
    if (new URL(url).protocol === "https:") {
      void shell.openExternal(url)
    } else {
      console.warn(`Refused to open non-https external URL: ${url}`)
    }
  } catch {
    console.warn(`Refused to open malformed external URL: ${url}`)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: config.productName,
    width: config.windowOpts.width,
    height: config.windowOpts.height,
    frame: true,
    autoHideMenuBar: config.windowOpts.autoHideMenuBar,
    kiosk: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webviewTag: true,
      // Modern Electron defaults — stated explicitly so future upgrades
      // don't silently regress.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"))

  // Lock down the chrome window: no new windows, no navigation away from the
  // bundled renderer page. The webview's own webContents is locked down on
  // attach below.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.on(
    "did-attach-webview",
    (_event, webviewWebContents) => {
      webviewWebContents.setWindowOpenHandler(() => ({ action: "deny" }))

      // PDF downloads (signed Storage URLs served with
      // `Content-Disposition: attachment`) fire `will-download` rather than
      // `will-navigate`. Inside the menu-less kiosk webview these surface no
      // save UI and silently go nowhere (issue #376). Cancel the in-webview
      // download and hand the URL to the OS default browser/PDF viewer.
      webviewWebContents.session.on("will-download", (event, item) => {
        event.preventDefault()
        openExternalIfSafe(item.getURL())
      })

      webviewWebContents.on("will-navigate", (event, navUrl) => {
        try {
          const allowed = new URL(config.url).origin
          const target = new URL(navUrl).origin
          if (target !== allowed) {
            console.warn(
              `Blocked webview navigation to off-origin URL: ${navUrl}`
            )
            // Keep the kiosk page itself put, but if the off-origin target is
            // a real https resource (e.g. Chromium routed a download here
            // instead of `will-download`), open it externally rather than
            // dropping it silently.
            event.preventDefault()
            openExternalIfSafe(navUrl)
          }
        } catch {
          event.preventDefault()
        }
      })
    }
  )

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.send("bridge:url-change", config.url)
  })
}

// NFC subscriber set: every webContents (the chrome renderer + the loaded
// webview) calls `bridge:nfc-subscribe` from its preload and gets removed
// automatically on destroy. The main process broadcasts each tag read to
// all current subscribers — no manual bookkeeping per window.
const nfcSubscribers = new Set<WebContents>()

ipcMain.on("bridge:nfc-subscribe", (event) => {
  const wc = event.sender
  if (nfcSubscribers.has(wc)) return
  nfcSubscribers.add(wc)
  wc.once("destroyed", () => nfcSubscribers.delete(wc))
})

function dispatchNfc(event: NfcTagEvent): void {
  for (const wc of nfcSubscribers) {
    try {
      wc.send("bridge:nfc-tag", event)
    } catch (err) {
      console.warn(
        "Failed to dispatch NFC event:",
        err instanceof Error ? err.message : err
      )
    }
  }
}

// Synchronous bootstrap payload delivered to the preload at startup.
// Sandboxed preloads can't `require("./build-config.generated")` reliably, so
// the mode is plumbed through here alongside the feature list. Keep
// this serialisable — `event.returnValue` goes through Electron's
// structured clone.
const bridgeBootstrap = {
  mode: config.mode,
  features: ["nfc", ...(config.printer ? ["print"] : [])] as readonly string[],
}

// IPC handles backing the `window.bridge.*` preload API
ipcMain.on("bridge:bootstrap", (event) => {
  event.returnValue = bridgeBootstrap
})
ipcMain.handle("bridge:get-url", () => config.url)
ipcMain.handle("bridge:bearer", () => config.bearer || null)
ipcMain.handle("bridge:reset-session", async () => {
  if (config.mode !== "kiosk") return
  await clearSession()
})
ipcMain.handle(
  "bridge:print",
  async (_event, bytes: Uint8Array | ArrayBuffer) => {
    if (!config.printer) {
      throw new Error(
        "Printer not configured (BRIDGE_PRINTER_HOST is unset)"
      )
    }
    const buf =
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    return sendToPrinter(config.printer, buf)
  }
)

app.whenReady().then(async () => {
  // Always start kiosk from a clean session — any leftover IndexedDB /
  // cookies / Firebase Auth state from a previous run is wiped before the
  // renderer attaches its webview. Admin keeps its session across restarts.
  if (config.mode === "kiosk") {
    await clearSession()
  }
  createWindow()
  startNfc({ onTag: dispatchNfc })
})

app.on("window-all-closed", () => {
  app.quit()
})
