// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { contextBridge, ipcRenderer } from "electron"
import { BRIDGE_MODE } from "./mode.generated"
import type { Bridge, NfcTagEvent } from "./types"

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

const bridge: Bridge = {
  mode: BRIDGE_MODE,
  features: ["nfc"],
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
}

contextBridge.exposeInMainWorld("bridge", bridge)
