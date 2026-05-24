// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { contextBridge, ipcRenderer } from "electron"
import type { Bridge, BridgeMode, NfcTagEvent } from "./types"

// Per-context subscriber sets. The main process broadcasts NFC events to
// every webContents that has called `bridge:nfc-subscribe`, so a single
// renderer + the loaded webview both get the same events without the main
// process needing to track them by hand.

const nfcCallbacks = new Set<(p: NfcTagEvent) => void>()
let nfcSubscribed = false

ipcRenderer.on("bridge:nfc-tag", (_event, payload: NfcTagEvent) => {
  nfcCallbacks.forEach((cb) => cb(payload))
})

const urlCallbacks = new Set<(url: string) => void>()

ipcRenderer.on("bridge:url-change", (_event, url: string) => {
  urlCallbacks.forEach((cb) => cb(url))
})

// Bootstrap (mode + features) is delivered synchronously from main so
// the preload doesn't depend on any sibling module (sandboxed preloads
// can't reliably resolve relative requires).
const bootstrap = ipcRenderer.sendSync("bridge:bootstrap") as {
  mode: BridgeMode
  features: readonly string[]
}

const bridge: Bridge = {
  mode: bootstrap.mode,
  features: bootstrap.features,
  bearer: () => ipcRenderer.invoke("bridge:bearer"),
  resetSession: () => ipcRenderer.invoke("bridge:reset-session"),
  getUrl: () => ipcRenderer.invoke("bridge:get-url"),
  onUrlChange: (cb) => {
    urlCallbacks.add(cb)
    return () => urlCallbacks.delete(cb)
  },
  onNfcTag: (cb) => {
    nfcCallbacks.add(cb)
    if (!nfcSubscribed) {
      nfcSubscribed = true
      ipcRenderer.send("bridge:nfc-subscribe")
    }
    return () => {
      nfcCallbacks.delete(cb)
    }
  },
  print: (bytes) => ipcRenderer.invoke("bridge:print", bytes),
}

contextBridge.exposeInMainWorld("bridge", bridge)
