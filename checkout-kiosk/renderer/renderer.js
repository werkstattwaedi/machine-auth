// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

const webview = document.getElementById("checkout-view")
const btnReset = document.getElementById("btn-reset")

let baseUrl = ""

// Load base URL and navigate immediately
window.kiosk.getCheckoutUrl().then((url) => {
  baseUrl = url
  if (!webview.src || webview.src === "about:blank") {
    webview.src = baseUrl
  }
})

// Also set on DOM ready in case IPC is slow
webview.addEventListener("dom-ready", () => {
  console.log("Webview loaded:", webview.src)
})

// "Neuer Checkout" resets to base URL
btnReset.addEventListener("click", () => {
  webview.src = baseUrl
})

// NFC tag detected — navigate webview to checkout with picc/cmac params
window.kiosk.onNfcTag((url) => {
  try {
    const parsed = new URL(url)
    const picc = parsed.searchParams.get("picc") || parsed.searchParams.get("e")
    const cmac = parsed.searchParams.get("cmac") || parsed.searchParams.get("m")

    if (picc && cmac) {
      const target = new URL(baseUrl)
      target.searchParams.set("picc", picc)
      target.searchParams.set("cmac", cmac)
      const targetUrl = target.toString()
      console.log("Navigating webview to:", targetUrl)
      webview.src = targetUrl
    }
  } catch (err) {
    console.error("Failed to parse NFC URL:", err)
  }
})
