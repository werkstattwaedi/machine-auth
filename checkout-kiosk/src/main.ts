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
import { resolveConfig } from "./config"
import { startNfc } from "./bridge/nfc"
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
      webviewWebContents.on("will-navigate", (event, navUrl) => {
        try {
          const allowed = new URL(config.url).origin
          const target = new URL(navUrl).origin
          if (target !== allowed) {
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

// IPC handles backing the `window.bridge.*` preload API
ipcMain.handle("bridge:get-url", () => config.url)
ipcMain.handle("bridge:bearer", () => config.bearer || null)
ipcMain.handle("bridge:reset-session", async () => {
  if (config.mode !== "kiosk") return
  await clearSession()
})

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
