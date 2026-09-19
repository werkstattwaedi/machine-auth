// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  session,
  Tray,
  webContents,
  type WebContents,
} from "electron"
import path from "node:path"
import { spawn } from "node:child_process"
import {
  decideKioskOverlay,
  isAllowedKioskOverlayNavigation,
  RAISENOW_PAYLINK_ORIGIN,
} from "@oww/shared"
import { resolveConfig } from "./config"
import { startNfc } from "./bridge/nfc"
import { performSessionReset } from "./reset-session"
import {
  createDisplayWaker,
  SCREENSAVER_DISMISSED_EXIT,
  wakeCommandArgs,
} from "./wake-display"
import type { NfcTagEvent, ResetSessionOptions } from "./types"

const config = resolveConfig()

// Off-origin URLs the checkout app links to via target="_blank" that should
// open inside the in-kiosk overlay webview (with a close button) instead of
// being denied. The webview's default deny-all stays in place for everything
// else. werkstattwaedi.ch hosts the Nutzungsbestimmungen page (#425); the
// RaiseNow paylink origin hosts the TWINT payment page (#416).
const OVERLAY_ALLOWLIST = [
  "https://werkstattwaedi.ch",
  RAISENOW_PAYLINK_ORIGIN,
] as const

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
let tray: Tray | null = null
// Distinguishes a real quit (tray "Beenden" / app.quit) from the user closing
// the window, which we intercept to hide-to-tray instead of tearing down.
let isQuitting = false

// Tray + window icon. Loaded from the bundled assets dir (packed via the
// electron-builder `files` glob); `__dirname` is `dist/`, so the assets sit one
// level up. `.ico` carries the crisp small sizes Windows' tray wants; other
// platforms use the PNG. nativeImage reads fine from inside the asar.
function appIcon(): Electron.NativeImage {
  const file = process.platform === "win32" ? "icon.ico" : "tray-icon.png"
  return nativeImage.createFromPath(path.join(__dirname, "..", "assets", file))
}

// How long the kiosk stays pinned above everything after being surfaced. Long
// enough to outlast Windows handing the foreground back to the pre-screensaver
// window, and for someone walking up to start touching the screen — a touch
// gives the window focus the legitimate way. Then we let it go, so the kiosk
// does not permanently cover the (transition-phase) browser.
const TOPMOST_HOLD_MS = 5_000

let topmostTimer: ReturnType<typeof setTimeout> | null = null

// Windows refuses SetForegroundWindow to a process that is neither the
// foreground process nor started by it, which is exactly the kiosk's position
// after a screensaver: the tap gets a taskbar flash, the window shows for an
// instant, and the previously-focused window is handed back the foreground.
// `focus({steal:true})` does not lift that restriction — measured on Windows
// 11, the kiosk never reached the foreground at all.
//
// Z-order is not policed the same way. Pinning the window always-on-top is a
// pure SetWindowPos call needing no foreground right, and it verifiably moves
// the kiosk in front of the window that otherwise wins. So put it on top, and
// release it shortly after.
function pinAboveEverything(): void {
  if (!mainWindow) return
  // "screen-saver" is Electron's highest level — above ordinary topmost
  // windows, which is what a walk-up terminal wants.
  mainWindow.setAlwaysOnTop(true, "screen-saver")
  if (topmostTimer) clearTimeout(topmostTimer)
  topmostTimer = setTimeout(() => {
    topmostTimer = null
    mainWindow?.setAlwaysOnTop(false)
  }, TOPMOST_HOLD_MS)
}

/** Drop the pin immediately (e.g. when hiding back to the tray). */
function unpin(): void {
  if (topmostTimer) {
    clearTimeout(topmostTimer)
    topmostTimer = null
  }
  mainWindow?.setAlwaysOnTop(false)
}

// Bring the kiosk to the foreground (badge tap / tray click). Idempotent when
// already visible — a mid-checkout tap just re-focuses.
function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  // Maximized whenever it is surfaced: the configured width/height are only a
  // fallback, and at the 1280×900 default the payment page's QR code and the
  // overlay close button fell below the fold on the kiosk screen (issue
  // #458). This used to happen at startup, but maximize() also shows the
  // window, which defeated starting minimized.
  if (!mainWindow.isMaximized()) mainWindow.maximize()
  mainWindow.focus()
  // steal:true so we actually surface above the (transition-phase) browser
  // running the old checkout, instead of merely flashing the taskbar.
  app.focus({ steal: true })
  // Best-effort focus above is not enough on Windows; the pin is what actually
  // puts the kiosk in front.
  pinAboveEverything()
}

function hideWindow(): void {
  unpin()
  mainWindow?.hide()
}

// Re-assert the foreground at these delays (ms) after a screensaver was torn
// down. Windows hands the foreground back to whatever held it before the
// screensaver engaged, and does so slightly after the process dies, so a
// single immediate call loses the race. Cheap and idempotent — showWindow()
// on an already-focused window is a no-op in practice.
const FOREGROUND_REASSERT_MS = [0, 300, 900, 2000] as const

// Raising the window is not enough when the terminal has gone to the
// screensaver: it paints over the kiosk, so the tap looks ignored and users
// reach for the mouse. Synthetic input cannot fix that — the screensaver runs
// on its own desktop and never sees it — so wake-display.ts asks the
// screensaver to close itself (WM_CLOSE) instead. Best effort by design: a
// failed attempt leaves the user exactly where they were (jiggling the
// mouse), so it must never break the tap itself.
const wakeDisplay = createDisplayWaker({
  platform: process.platform,
  now: () => Date.now(),
  nudge: (onDismissed) => {
    try {
      const child = spawn("powershell.exe", [...wakeCommandArgs()], {
        windowsHide: true,
        stdio: "ignore",
      })
      // A missing powershell.exe surfaces as an 'error' event, not a throw;
      // unhandled it would take the whole main process down with it.
      child.on("error", (err) => {
        console.warn("Failed to wake the display:", err.message)
      })
      // Only a genuine dismissal needs the foreground re-asserted; an ordinary
      // tap (exit 0, no screensaver was up) already landed in front.
      child.on("close", (code) => {
        if (code === SCREENSAVER_DISMISSED_EXIT) onDismissed()
      })
    } catch (err) {
      console.warn(
        "Failed to wake the display:",
        err instanceof Error ? err.message : err
      )
    }
  },
})

// Closing the window mid-session must end the session, not just hide it —
// otherwise the previous user stays authenticated until the idle timeout and
// their session leaks into the next person's checkout. So a close does the same
// thing "Neuer Checkout" does: wipe the session, then hide to the tray.
// `clearSession()` runs here in main (independent of the renderer) so a wedged
// webview can't skip the security-critical Firebase Auth wipe; the
// `bridge:reload-checkout` message then drops the still-live in-memory session
// by reloading the checkout webview.
async function endSessionAndHide(): Promise<void> {
  hideWindow()
  await clearSession()
  mainWindow?.webContents.send("bridge:reload-checkout")
}

// System-tray presence so a closed / hidden kiosk stays running and reachable.
function createTray(): void {
  tray = new Tray(appIcon())
  // Tooltip carries the version so the tray/taskbar hover identifies exactly
  // which build is running — the window itself starts hidden, so this is the
  // only always-visible place the version shows. `app.getVersion()` reads the
  // single source of truth: the `version` field in package.json.
  tray.setToolTip(`${config.productName} v${app.getVersion()}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Checkout anzeigen", click: () => showWindow() },
      { type: "separator" },
      {
        label: "Beenden",
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ])
  )
  tray.on("click", () => showWindow())
  tray.on("double-click", () => showWindow())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: config.productName,
    width: config.windowOpts.width,
    height: config.windowOpts.height,
    frame: true,
    icon: appIcon(),
    // Start hidden in the tray: during the transition phase the kiosk must
    // never cover the browser running the old checkout. A badge tap (or the
    // tray) brings it forward for users who opt into the new flow.
    show: false,
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

  // Closing the window hides it to the tray instead of quitting, so the kiosk
  // keeps running (NFC reader stays live) and can be re-summoned by a badge tap.
  // Closing mid-session also ends the session so it can't leak to the next user
  // (see endSessionAndHide). Only a real quit (tray "Beenden") tears it down.
  mainWindow.on("close", (event) => {
    if (isQuitting) return
    event.preventDefault()
    void endSessionAndHide()
  })

  // Start hidden in the tray: leave the window exactly as `show: false`
  // created it. Do NOT maximize (or minimize) here — Electron's maximize()
  // also shows a hidden window, which is how the old start-maximized call
  // made the kiosk come up visible and full-screen on every launch.
  // showWindow() maximizes when the kiosk is actually surfaced.

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
      // spawns. For allowlisted off-origin links (e.g. the Nutzungsbestimmungen
      // page #425 or the RaiseNow TWINT paylink #416) we instead ask the chrome
      // renderer to mount an in-kiosk overlay webview pointing at the URL — the
      // overlay is torn down on close, so nothing lingers outside the kiosk.
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
        // The checkout origin is always allowed. Overlay webviews navigate
        // within an allowlisted off-origin (e.g. werkstattwaedi.ch for the
        // Nutzungsbestimmungen page) and across RaiseNow's own domain family
        // for the TWINT payment (pay.raisenow.io → twint.raisenow.io, #470),
        // so permit those too — the overlay is created and torn down by the
        // renderer.
        if (
          !isAllowedKioskOverlayNavigation(navUrl, {
            checkoutOrigin: new URL(config.url).origin,
            allowedOverlayOrigins: OVERLAY_ALLOWLIST,
          })
        ) {
          console.warn(`Blocked webview navigation to off-origin URL: ${navUrl}`)
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

// The chrome renderer detects the RaiseNow payment_result URL on the overlay
// webview and forwards it here; re-broadcast to every subscribed webContents
// so the checkout webview (web app) can mark the bill paid (#416). The
// overlay webview itself is not a subscriber, so it never echoes back.
ipcMain.on("bridge:payment-confirmed", (_event, paymentUuid: string) => {
  for (const wc of nfcSubscribers) {
    try {
      wc.send("bridge:payment-confirmed", paymentUuid)
    } catch (err) {
      console.warn(
        "Failed to dispatch payment-confirmed event:",
        err instanceof Error ? err.message : err
      )
    }
  }
})

function dispatchNfc(event: NfcTagEvent): void {
  // Subscriber count matters while chasing silent taps: 0 means nobody is
  // listening (webview not loaded / preload not run), 1 is usually only the
  // chrome renderer — the checkout web app expects to be the 2nd.
  console.log(
    `[nfc] dispatching tag event to ${nfcSubscribers.size} subscriber(s)`
  )
  // A badge tap on the terminal brings the kiosk to the front — this is how a
  // new user surfaces the checkout app from the tray (issue: tray/foreground).
  // The screensaver has to go first: it paints over everything, so without
  // this the window comes up behind it and the tap reads as a no-op. Tearing
  // it down is asynchronous, and the showWindow() below therefore runs while
  // the screensaver still owns the screen — which Windows discards — so
  // re-assert once it is actually gone.
  wakeDisplay(() => {
    for (const ms of FOREGROUND_REASSERT_MS) {
      setTimeout(() => showWindow(), ms)
    }
  })
  showWindow()
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
// "Neuer Checkout" reset request/ack (issue #415). The chrome renderer asks
// the loaded web page to show its confirm dialog; the page acks once it has
// the request. Both are broadcast to every webContents (chrome renderer +
// webview) — the originating sender simply ignores the echo since it doesn't
// subscribe to the opposite channel.
function broadcastToAll(channel: string): void {
  for (const wc of webContents.getAllWebContents()) {
    try {
      wc.send(channel)
    } catch (err) {
      console.warn(
        `Failed to broadcast ${channel}:`,
        err instanceof Error ? err.message : err
      )
    }
  }
}

ipcMain.on("bridge:request-start-over", () => {
  broadcastToAll("bridge:request-start-over")
})
ipcMain.on("bridge:start-over-ack", () => {
  broadcastToAll("bridge:start-over-ack")
})

ipcMain.handle("bridge:get-url", () => config.url)
ipcMain.handle("bridge:bearer", () => config.bearer || null)
// The single chokepoint for the web-confirm, badge-takeover, and fallback
// reset paths. Default: autohide back to the tray so the kiosk only reappears
// when the next user taps a badge. A badge takeover passes
// `keepWindowOpen: true` so the window stays in front for the user who just
// tapped (issue #516) — the decision lives in performSessionReset.
ipcMain.handle(
  "bridge:reset-session",
  (_event, opts?: ResetSessionOptions) =>
    performSessionReset({ clearSession, hideWindow }, opts)
)

app.whenReady().then(async () => {
  // Always start from a clean session — any leftover IndexedDB / cookies /
  // Firebase Auth state from a previous run is wiped before the renderer
  // attaches its webview.
  await clearSession()
  createTray()
  createWindow()
  startNfc({ onTag: dispatchNfc })
})

// Any quit path (tray "Beenden", OS shutdown) flips the flag so the window's
// close handler tears down instead of hiding.
app.on("before-quit", () => {
  isQuitting = true
})

app.on("window-all-closed", () => {
  app.quit()
})
