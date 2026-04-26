// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("kiosk", {
  onNfcTag: (callback) =>
    ipcRenderer.on("nfc-tag", (_event, url) => callback(url)),
  onCheckoutUrl: (callback) =>
    ipcRenderer.on("checkout-url", (_event, url) => callback(url)),
  getCheckoutUrl: () => ipcRenderer.invoke("get-checkout-url"),
  // Per-kiosk Bearer used by the web app's useTokenAuth to authenticate
  // verifyTagCheckout. Exposed as an IPC handle (not a static property)
  // so the value isn't sitting on a globally-readable object — slightly
  // raises the bar for dev-tools probing, though anyone with main-process
  // access can still extract it.
  bearer: () => ipcRenderer.invoke("get-kiosk-bearer"),
  // Wipe the webview's session storage. Called from the Neuer Checkout
  // button and from the web app's inactivity / post-payment auto-reset.
  resetSession: () => ipcRenderer.invoke("reset-kiosk-session"),
})
