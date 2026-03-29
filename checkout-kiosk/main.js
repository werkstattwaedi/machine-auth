// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const { NFC } = require("nfc-pcsc")

const CHECKOUT_URL =
  process.env.CHECKOUT_URL || "https://localhost:5173/?kiosk"

// Accept self-signed certs in dev (Vite basicSsl plugin)
if (CHECKOUT_URL.includes("localhost")) {
  app.commandLine.appendSwitch("ignore-certificate-errors")
}

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Offene Werkstatt – Checkout",
    width: 1280,
    height: 900,
    frame: true,
    autoHideMenuBar: true,
    kiosk: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webviewTag: true,
    },
  })

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"))

  // Pass checkout URL to renderer
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("checkout-url", CHECKOUT_URL)
  })
}

// --- NFC reader (deferred — app works without a reader/pcscd) ---

function initNfc() {
  try {
    const nfc = new NFC()

    nfc.on("reader", (reader) => {
      console.log(`NFC reader connected: ${reader.name}`)

      // Disable nfc-pcsc's built-in auto-processing entirely
      reader.autoProcessing = false

      reader.on("card", async (card) => {
        try {
          const url = await readNdefUrl(reader)
          if (url) {
            console.log(`Tag read: ${url}`)
            mainWindow?.webContents.send("nfc-tag", url)
          }
        } catch (err) {
          console.error("Failed to read tag:", err.message)
        }
      })

      reader.on("error", (err) => {
        // Suppress noisy transmit errors from flaky contactless
        if (!err.message?.includes("transmitting")) {
          console.error(`Reader error: ${err.message}`)
        }
      })
    })

    nfc.on("error", (err) => {
      console.error(`NFC error: ${err.message}`)
    })
  } catch (err) {
    console.warn(`NFC not available: ${err.message}`)
    console.warn("The app will work without NFC. Plug in a reader and restart to enable NFC.")
  }
}

/**
 * Read NDEF URI record from an NTAG424 DNA tag via ISO 7816-4 APDUs.
 */
async function readNdefUrl(reader) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))

  // Helper: transmit with inter-APDU delay and SW check
  async function send(apdu, resLen = 260) {
    await delay(10)
    const resp = await reader.transmit(Buffer.from(apdu), resLen)
    const sw = resp.subarray(-2).readUInt16BE(0)
    if (sw !== 0x9000) throw new Error(`APDU failed: SW=${sw.toString(16)}`)
    return resp.subarray(0, -2)
  }

  // 1. SELECT NDEF application
  await send([0x00, 0xa4, 0x04, 0x00, 0x07,
    0xd2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00])

  // 2. SELECT NDEF file (E104)
  await send([0x00, 0xa4, 0x00, 0x0c, 0x02, 0xe1, 0x04])

  // 3. READ BINARY — first 2 bytes = NLEN
  const nlenResp = await send([0x00, 0xb0, 0x00, 0x00, 0x02])
  const nlen = nlenResp.readUInt16BE(0)
  if (nlen === 0 || nlen > 1024) {
    throw new Error(`Invalid NLEN: ${nlen}`)
  }

  // 4. READ BINARY — NDEF message, chunked to stay within contactless frame limits
  const chunkSize = 48
  const chunks = []
  let remaining = nlen
  let offset = 2

  while (remaining > 0) {
    const len = Math.min(remaining, chunkSize)
    const chunk = await send(
      [0x00, 0xb0, (offset >> 8) & 0xff, offset & 0xff, len],
      len + 2,
    )
    chunks.push(chunk)
    offset += len
    remaining -= len
  }

  // 5. Parse NDEF URI record
  return parseNdefUri(Buffer.concat(chunks))
}

/**
 * Parse an NDEF message containing a single URI record.
 * Returns the full URL string or null.
 */
function parseNdefUri(ndef) {
  if (ndef.length < 4) return null
  const header = ndef[0]
  const tnf = header & 0x07
  if (tnf !== 0x01) return null

  // Assumes Short Record (SR bit set) — always true for NTAG424 NDEF URLs.
  const typeLen = ndef[1]
  const payloadLen = ndef[2]
  const type = ndef[3]
  if (type !== 0x55) return null

  const payloadStart = 3 + typeLen
  if (payloadStart + payloadLen > ndef.length) return null
  const prefixCode = ndef[payloadStart]
  const rest = ndef.subarray(payloadStart + 1, payloadStart + payloadLen).toString("utf8")

  const URI_PREFIXES = [
    "", "http://www.", "https://www.", "http://", "https://",
  ]
  return (URI_PREFIXES[prefixCode] ?? "") + rest
}

// --- App lifecycle ---

app.whenReady().then(() => {
  createWindow()
  initNfc()
})

app.on("window-all-closed", () => {
  app.quit()
})

ipcMain.handle("get-checkout-url", () => CHECKOUT_URL)
