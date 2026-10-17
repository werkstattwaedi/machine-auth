// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// A fake Wallee A35 speaking LTI framing over TCP, for local development
// and the kiosk's state-machine tests. It plays scripted scenarios modelled
// on the frames captured from the real terminal (src/bridge/fixtures/).
//
//   npx tsx checkout-kiosk/scripts/lti-sim.ts --scenario approve [--port 50000]
//
// then start the kiosk with TERMINAL_HOST=127.0.0.1. Like the real
// terminal, an abortCardEntryNotification works only until the card is read
// and the simulator never closes the connection after its final answer.

import net from "node:net"
import {
  encodeFrame,
  FrameDecoder,
  type LtiMessage,
  parseLtiMessage,
} from "../src/bridge/lti-codec"

export const LTI_SIM_SCENARIOS = [
  /** Contactless card, approved for the full amount. */
  "approve",
  /** TWINT QR scan instead of a card, approved. */
  "twint-approve",
  /** Card read, then declined ("Abgelehnt"). */
  "decline",
  /** Waits for a card that never comes; an abort ends it with TRM.PT.0002. */
  "abort-before-card",
  /** Card read at once, long processing; an abort is ignored, then approved. */
  "card-read-then-ignore-abort",
  /** Starts, then never says anything again and ignores aborts. */
  "hang",
  /** Card read, then the connection drops. */
  "drop",
  /** No card within the card-in timeout: TRM.PT.0201. */
  "timeout",
  /** Card unknown to the terminal: TRM.PT.0500. */
  "unknown-card",
  /** Sends an (unexpected) confirmationRequest mid-transaction, then approves. */
  "confirmation-request",
] as const

export type LtiSimScenario = (typeof LTI_SIM_SCENARIOS)[number]

export interface LtiSimOptions {
  scenario: LtiSimScenario
  port?: number
  host?: string
  /** Delay before the card is presented. */
  cardDelayMs?: number
  /** Delay between the other frames of a scenario. */
  stepMs?: number
  log?: (line: string) => void
}

export interface LtiSim {
  port: number
  /** Every message received from the till, in order. */
  received: LtiMessage[]
  /** Number of connections accepted so far. */
  connections: number
  close(): Promise<void>
}

const DEVICE = 'xmlns:vcs-device="http://www.vibbek.com/device"'
const POS = 'xmlns:vcs-pos="http://www.vibbek.com/pos"'
const HEAD = '<?xml version="1.0" encoding="utf-8"?>'

const device = (name: string, inner = "", attrs = "") =>
  `${HEAD}<vcs-device:${name}${attrs} ${DEVICE}>${inner}</vcs-device:${name}>`
const pos = (name: string, inner = "") => `${HEAD}<vcs-pos:${name} ${POS}>${inner}</vcs-pos:${name}>`
const display = (type: "CARDHOLDER" | "ATTENDANT", lines: string[]) =>
  device(
    "displayNotification",
    `<display>${lines.map((l) => `<line>${l}</line>`).join("")}</display>`,
    ` displayType="${type}"`
  )
const errorNotification = (code: string, ref?: string, text?: string) =>
  pos(
    "errorNotification",
    `${text ? `<errorText>${text}</errorText>` : ""}<errorCode>${code}</errorCode>` +
      `${ref ? `<merchantReference>${ref}</merchantReference>` : ""}`
  )
const trxResponse = (opts: {
  trxResult: number
  amountAuth: number
  ref?: string
  label: string
  entry: string
}) =>
  pos(
    "financialTrxResponse",
    `<ep2AuthResponseCode>${opts.trxResult === 0 ? "00" : "01"}</ep2AuthResponseCode>` +
      `<ep2TrmId>12345678</ep2TrmId><trxResult>${opts.trxResult}</trxResult>` +
      `<amountAuth>${opts.amountAuth}</amountAuth><amountAuthCurr>756</amountAuthCurr>` +
      `<cardAppLabel>${opts.label}</cardAppLabel>` +
      `${opts.ref ? `<merchantReference>${opts.ref}</merchantReference>` : ""}` +
      `<paymentEntryMethod>${opts.entry}</paymentEntryMethod>`
  )

type Step =
  | { wait: "card" | "step" | "long" }
  | { send: string; cardRead?: boolean }
  | { drop: true }
  | { hang: true }

function script(scenario: LtiSimScenario, amount: number, ref?: string): Step[] {
  const start: Step = { send: device("trxStartNotification") }
  const card: Step = { send: device("cardEntryNotification", "<cardEntryMode>2</cardEntryMode>"), cardRead: true }
  const removal: Step = { send: device("cardRemovalNotification") }
  const end: Step = { send: device("trxEndNotification") }
  const ok = (label: string, entry: string): Step[] => [
    { send: display("CARDHOLDER", ["", "Verarbeitung OK"]) },
    { send: display("ATTENDANT", ["Verarbeitung OK"]) },
    { wait: "step" },
    end,
    { send: trxResponse({ trxResult: 0, amountAuth: amount, ref, label, entry }) },
  ]
  switch (scenario) {
    case "approve":
      return [start, { wait: "card" }, card, removal, { wait: "step" }, ...ok("MastercardCtless", "CTLS")]
    case "twint-approve":
      return [
        start,
        { wait: "card" },
        { send: device("qrCodeScanNotification"), cardRead: true },
        { wait: "step" },
        ...ok("TWINT", "QR"),
      ]
    case "decline":
      return [
        start,
        { wait: "card" },
        card,
        removal,
        { wait: "step" },
        { send: display("CARDHOLDER", ["", "Abgelehnt"]) },
        { send: display("ATTENDANT", ["Abgelehnt"]) },
        end,
        { send: trxResponse({ trxResult: 1, amountAuth: 0, ref, label: "MastercardCtless", entry: "CTLS" }) },
      ]
    case "abort-before-card":
      return [start, { hang: true }]
    case "card-read-then-ignore-abort":
      return [start, card, removal, { wait: "long" }, ...ok("MastercardCtless", "CTLS")]
    case "hang":
      return [start, { hang: true }]
    case "drop":
      return [start, { wait: "card" }, card, { wait: "step" }, { drop: true }]
    case "timeout":
      return [start, { wait: "card" }, end, { send: errorNotification("TRM.PT.0201", ref) }]
    case "unknown-card":
      return [
        start,
        { wait: "card" },
        { send: device("qrCodeScanNotification"), cardRead: true },
        { send: display("CARDHOLDER", ["", "Karte unbekannt"]) },
        { wait: "step" },
        end,
        { send: errorNotification("TRM.PT.0500", ref) },
      ]
    case "confirmation-request":
      return [
        start,
        { wait: "card" },
        card,
        {
          send: device(
            "confirmationRequest",
            "<display><line>Bitte bestätigen</line></display><timeout>30</timeout>",
            ' displayType="ATTENDANT"'
          ),
        },
        { wait: "step" },
        ...ok("MastercardCtless", "CTLS"),
      ]
  }
}

export function startLtiSim(options: LtiSimOptions): Promise<LtiSim> {
  const cardDelayMs = options.cardDelayMs ?? 3_000
  const stepMs = options.stepMs ?? 300
  const log = options.log ?? (() => {})
  const sockets = new Set<net.Socket>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const received: LtiMessage[] = []
  let connections = 0

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
  }

  const server = net.createServer((socket) => {
    connections++
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => {})
    const decoder = new FrameDecoder()
    let cardRead = false
    // Set while a transaction runs; cleared by its final message so a
    // late abort hits nothing, as on the terminal.
    let activeRef: string | undefined
    let transactionOpen = false
    let stopped = false

    const send = (xml: string) => {
      if (socket.destroyed) return
      log(`<<< ${xml}`)
      socket.write(encodeFrame(xml))
    }

    const run = (steps: Step[], i: number) => {
      if (stopped || socket.destroyed || i >= steps.length) {
        transactionOpen = false
        return
      }
      const step = steps[i]
      if ("wait" in step) {
        const ms = step.wait === "card" ? cardDelayMs : step.wait === "long" ? stepMs * 10 : stepMs
        later(ms, () => run(steps, i + 1))
        return
      }
      if ("hang" in step) return
      if ("drop" in step) {
        socket.destroy()
        return
      }
      if (step.cardRead) cardRead = true
      send(step.send)
      run(steps, i + 1)
    }

    socket.on("data", (chunk: Buffer) => {
      let frames: string[]
      try {
        frames = decoder.push(chunk)
      } catch {
        socket.destroy()
        return
      }
      for (const xml of frames) {
        log(`>>> ${xml}`)
        let msg: LtiMessage
        try {
          msg = parseLtiMessage(xml)
        } catch {
          continue
        }
        received.push(msg)
        switch (msg.kind) {
          case "pingRequest":
            send(display("ATTENDANT", ["Connection OK"]))
            send(pos("pingResponse", "<server>lti-sim.invalid</server>"))
            break
          case "pinpadInformationRequest":
            send(
              pos(
                "pinpadInformationResponse",
                "<hardwareType>A35</hardwareType><vpjSoftwareVersion>1.2.54.1</vpjSoftwareVersion>" +
                  "<terminalId>12345678</terminalId>"
              )
            )
            break
          case "financialTrxRequest":
            activeRef = msg.merchantReference
            transactionOpen = true
            cardRead = false
            run(script(options.scenario, msg.amount ?? 0, activeRef), 0)
            break
          case "abortCardEntry":
            if (!transactionOpen || cardRead) break
            if (options.scenario === "hang") break
            stopped = true
            transactionOpen = false
            later(stepMs, () => {
              send(device("trxAbortNotification"))
              send(errorNotification("TRM.PT.0002", activeRef, "Stopp des Kunden"))
            })
            break
        }
      }
    })
  })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo
      resolve({
        port: address.port,
        received,
        get connections() {
          return connections
        },
        close: () =>
          new Promise<void>((done) => {
            for (const t of timers) clearTimeout(t)
            for (const s of sockets) s.destroy()
            server.close(() => done())
          }),
      })
    })
  })
}

function parseArgs(argv: string[]): LtiSimOptions {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const scenario = (get("scenario") ?? "approve") as LtiSimScenario
  if (!LTI_SIM_SCENARIOS.includes(scenario)) {
    console.error(`Unknown scenario ${scenario}. One of: ${LTI_SIM_SCENARIOS.join(", ")}`)
    process.exit(2)
  }
  return {
    scenario,
    port: Number(get("port") ?? 50000),
    host: get("host") ?? "127.0.0.1",
    cardDelayMs: get("card-delay-ms") ? Number(get("card-delay-ms")) : undefined,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  }
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2))
  startLtiSim(opts).then((sim) => {
    console.log(`lti-sim: scenario "${opts.scenario}" listening on ${opts.host}:${sim.port}`)
  })
}
