// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createConnection } from "node:net"
import { printer } from "@oww/shared"

export interface PrinterEndpoint {
  host: string
  port: number
}

/**
 * Parse `BRIDGE_PRINTER_HOST` env-var values. Accepts `host`, `host:port`,
 * or an empty/undefined string. Returns `null` when the printer isn't
 * configured (in which case the bridge should not advertise `"print"`
 * in its features list).
 */
export function parsePrinterEndpoint(
  raw: string | undefined,
): PrinterEndpoint | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const colon = trimmed.lastIndexOf(":")
  if (colon === -1) return { host: trimmed, port: 9100 }
  const host = trimmed.slice(0, colon)
  const port = Number.parseInt(trimmed.slice(colon + 1), 10)
  if (!host || !Number.isFinite(port)) {
    throw new Error(`Invalid BRIDGE_PRINTER_HOST: ${raw}`)
  }
  return { host, port }
}

const CONNECT_TIMEOUT_MS = 3000
// PT-P950NW keeps TCP connections open expecting more jobs and never
// sends FIN after a write. Force-close shortly after the OS confirms
// our write so the next job doesn't sit in queue limbo. The linger
// also doubles as a passive read window: if the printer rejects the
// job, it pushes a 32-byte status frame within ~1 s; we parse that
// and translate to a German error message via @oww/shared/printer.
// 1.5 s has been the long-standing default in homebrew Brother drivers.
const POST_WRITE_LINGER_MS = 1500

/**
 * Send a raster job to the printer over TCP. Resolves once the OS has
 * confirmed our write and the linger has elapsed; rejects on connect
 * timeout, socket error, DNS failure, or a status frame from the
 * printer with an error byte set (e.g. cover open, wrong tape, no media).
 */
export function sendToPrinter(
  endpoint: PrinterEndpoint,
  bytes: Uint8Array,
): Promise<{ bytesSent: number }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (
      err: Error | null,
      result?: { bytesSent: number },
    ): void => {
      if (settled) return
      settled = true
      socket.destroy()
      if (err) reject(err)
      else if (result) resolve(result)
    }

    const socket = createConnection({
      host: endpoint.host,
      port: endpoint.port,
    })

    // Accumulate any bytes the printer sends after our write. The
    // PT-P950NW only replies when there's something to say (errors,
    // notifications); a happy job → silence.
    const incoming: Buffer[] = []
    socket.on("data", (chunk: Buffer) => {
      incoming.push(chunk)
    })

    const connectTimer = setTimeout(() => {
      finish(
        new Error(
          `Printer connect timeout: ${endpoint.host}:${endpoint.port}`,
        ),
      )
    }, CONNECT_TIMEOUT_MS)

    socket.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(connectTimer)
      finish(
        new Error(
          `${err.code ?? err.name ?? "ERR"} ${endpoint.host}:${endpoint.port}`,
        ),
      )
    })

    socket.once("connect", () => {
      clearTimeout(connectTimer)
      socket.write(Buffer.from(bytes), (writeErr) => {
        if (writeErr) {
          finish(writeErr)
          return
        }
        // Don't wait for FIN — Brother printers never send one. Linger
        // to let the OS flush and to catch any error reply, then close.
        setTimeout(() => {
          const reply = Buffer.concat(incoming)
          // The printer sometimes streams multiple 32-byte frames
          // (e.g. phase-change → error). Scan each window for an
          // error frame so we report the actual problem, not "phase
          // change" noise.
          for (let off = 0; off + 32 <= reply.length; off += 32) {
            const frame = new Uint8Array(reply.subarray(off, off + 32))
            const status = printer.parseStatus(frame)
            if (status && status.errors.length > 0) {
              finish(new Error(status.errors.join("; ")))
              return
            }
          }
          finish(null, { bytesSent: bytes.length })
        }, POST_WRITE_LINGER_MS)
      })
    })
  })
}
