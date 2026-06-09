// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  type WebContents,
} from "electron"
import path from "node:path"
import { decideKioskOverlay } from "@oww/shared"
import { resolveConfig } from "./config"
import { startNfc } from "./bridge/nfc"
import type { NfcTagEvent } from "./types"

const config = resolveConfig()

// Off-origin URLs the checkout app links to via target="_blank" that should
// open inside the in-kiosk overlay webview (with a close button) instead of
// being denied. The webview's default deny-all stays in place for everything
// else. werkstattwaedi.ch hosts the Nutzungsbestimmungen page (#425).
const OVERLAY_ALLOWLIST = ["https://werkstattwaedi.ch"] as const

// Accept self-signed certs in dev (Vite basicSsl plugin)
if (config.isDev) {
  app.commandLine.appendSwitch("ignore-certificate-errors")
}

// Kiosk uses a volatile, wipeable partition so a closed kiosk window equals a
// closed session.
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

  // Keep the OS window title pinned to the product name. The constructor
  // `title` is only a hint: once a document loads, its <title> takes over —
  // which is how the window previously ended up reading the renderer's
  // hardcoded title (issue #421). Re-assert it and block the page from
  // overriding it.
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault()
  })
  mainWindow.setTitle(config.productName)

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
      // Window-opens (target="_blank") stay denied so no native window
      // spawns. For allowlisted off-origin links (e.g. the
      // Nutzungsbestimmungen page) we instead ask the chrome renderer to
      // mount an in-kiosk overlay webview pointing at the URL — the overlay
      // is torn down on close, so nothing lingers outside the kiosk.
      webviewWebContents.setWindowOpenHandler(({ url }) => {
        if (
          decideKioskOverlay(url, { allowedOverlayOrigins: OVERLAY_ALLOWLIST })
            .open
        ) {
          mainWindow?.webContents.send("bridge:open-overlay", url)
        }
        return { action: "deny" }
      })
      webviewWebContents.on("will-navigate", (event, navUrl) => {
        try {
          const allowed = new URL(config.url).origin
          const target = new URL(navUrl).origin
          // The checkout origin is always allowed. Overlay webviews navigate
          // within an allowlisted off-origin (e.g. werkstattwaedi.ch for the
          // Nutzungsbestimmungen page), so permit those origins too — the
          // overlay is created and torn down by the renderer.
          if (
            target !== allowed &&
            !OVERLAY_ALLOWLIST.includes(target as (typeof OVERLAY_ALLOWLIST)[number])
          ) {
            console.warn(
              `Blocked webview navigation to off-origin URL: ${navUrl}`
            )
            event.preventDefault()
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
  features: ["nfc"] as readonly string[],
}

// IPC handles backing the `window.bridge.*` preload API
ipcMain.on("bridge:bootstrap", (event) => {
  event.returnValue = bridgeBootstrap
})
ipcMain.handle("bridge:get-url", () => config.url)
ipcMain.handle("bridge:bearer", () => config.bearer || null)
ipcMain.handle("bridge:reset-session", async () => {
  await clearSession()
})

app.whenReady().then(async () => {
  // Always start from a clean session — any leftover IndexedDB / cookies /
  // Firebase Auth state from a previous run is wiped before the renderer
  // attaches its webview.
  await clearSession()
  createWindow()
  startNfc({ onTag: dispatchNfc })
})

app.on("window-all-closed", () => {
  app.quit()
})
