// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("kiosk", {
  onNfcTag: (callback) => ipcRenderer.on("nfc-tag", (_event, url) => callback(url)),
  onCheckoutUrl: (callback) => ipcRenderer.on("checkout-url", (_event, url) => callback(url)),
  getCheckoutUrl: () => ipcRenderer.invoke("get-checkout-url"),
})
