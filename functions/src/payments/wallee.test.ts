// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import {
  customerReceiptText,
  isOtherEnvironmentReference,
  parseWebhookPayload,
  toWalleeTransaction,
} from "./wallee";
import { classifyTransaction } from "../invoice/terminal_payment";

// Shapes from the A35 spike (2026-10-16), ids replaced.
const RECEIPT_LINES = [
  "       Offene Werkstatt Wädenswil       ",
  "                                        ",
  "           *** Kundenbeleg ***          ",
  "Debit Mastercard contactless            ",
  "XXXXXXXXXXXX0000                        ",
  "Trm-Id:                         00000000",
  "Total-EFT CHF:                      3.00",
  "                                        ",
  "",
];

function receipt(typeId: number, enName: string, lines: string[]) {
  return {
    mimeType: "text/plain",
    receiptType: { id: typeId, name: { "de-DE": "x", "en-US": enName } },
    data: Buffer.from(lines.join("\r\n"), "utf8").toString("base64"),
  };
}

describe("customerReceiptText", () => {
  it("picks the cardholder receipt, decodes it and trims padding", () => {
    const text = customerReceiptText([
      receipt(1562577969856, "Merchant", ["Händlerbeleg"]),
      receipt(1562577925136, "Customer", RECEIPT_LINES),
    ]);
    expect(text).to.equal(
      [
        "       Offene Werkstatt Wädenswil",
        "",
        "           *** Kundenbeleg ***",
        "Debit Mastercard contactless",
        "XXXXXXXXXXXX0000",
        "Trm-Id:                         00000000",
        "Total-EFT CHF:                      3.00",
      ].join("\n"),
    );
  });

  it("is null without a cardholder receipt", () => {
    expect(customerReceiptText([receipt(1562577969856, "Merchant", ["x"])])).to.equal(null);
    expect(customerReceiptText([])).to.equal(null);
  });
});

// The fields the settlement reads, as the API returned them for the
// approved CHF 3.00 spike payment.
const RAW_TRANSACTION = {
  id: 600000001,
  state: "AUTHORIZED",
  authorizationAmount: 3,
  currency: "CHF",
  authorizedOn: "2026-10-16T09:39:04.865+02:00",
  merchantReference: "P-abcDEF0123456789wxyz-1",
  userInterfaceType: "TERMINAL",
  terminal: { id: 300 },
};

describe("toWalleeTransaction", () => {
  it("normalizes the API shape", () => {
    const t = toWalleeTransaction(RAW_TRANSACTION);
    expect(t).to.deep.equal({
      id: 600000001,
      state: "AUTHORIZED",
      authorizationAmount: 3,
      currency: "CHF",
      authorizedOn: new Date("2026-10-16T07:39:04.865Z"),
      merchantReference: "P-abcDEF0123456789wxyz-1",
      userInterfaceType: "TERMINAL",
      terminalId: 300,
    });
  });
});

describe("parseWebhookPayload", () => {
  it("reads a delivery's ids", () => {
    const body =
      '{"entityId":600000001,"eventId":1,"listenerEntityId":1472041829003,' +
      '"listenerEntityTechnicalName":"Transaction","spaceId":100,"state":"AUTHORIZED",' +
      '"timestamp":"2026-10-16T07:39:05+0000","webhookListenerId":2}';
    expect(parseWebhookPayload(body)).to.deep.equal({
      entityId: 600000001,
      listenerEntityId: 1472041829003,
      spaceId: 100,
      state: "AUTHORIZED",
      eventId: 1,
    });
  });

  it("refuses what isn't one", () => {
    expect(parseWebhookPayload("not json")).to.equal(null);
    expect(parseWebhookPayload('{"entityId":"1"}')).to.equal(null);
    expect(parseWebhookPayload("null")).to.equal(null);
  });
});

describe("isOtherEnvironmentReference", () => {
  it("tells staging and prod apart", () => {
    expect(isOtherEnvironmentReference("S-abc-1", "P")).to.equal(true);
    expect(isOtherEnvironmentReference("P-abc-1", "P")).to.equal(false);
    expect(isOtherEnvironmentReference("608434636", "P")).to.equal(false);
  });
});

describe("classifyTransaction", () => {
  const config = { spaceId: 100, userId: 200, terminalId: 300, referenceEnv: "P" as const };
  const base = toWalleeTransaction(RAW_TRANSACTION);

  it("lets a paid terminal payment of ours through", () => {
    expect(classifyTransaction(base, config)).to.equal(null);
    // The daily closing moves it on; still the same money.
    expect(classifyTransaction({ ...base, state: "COMPLETED" }, config)).to.equal(null);
    expect(classifyTransaction({ ...base, state: "FULFILL" }, config)).to.equal(null);
  });

  it("ignores what isn't a paid payment of our terminal", () => {
    for (const state of ["PROCESSING", "CONFIRMED", "FAILED", "VOIDED", "PENDING"]) {
      expect(classifyTransaction({ ...base, state }, config), state).to.equal("ignored");
    }
    expect(classifyTransaction({ ...base, terminalId: 999 }, config)).to.equal("ignored");
    expect(classifyTransaction({ ...base, userInterfaceType: "IFRAME" }, config)).to.equal(
      "ignored",
    );
  });

  it("sorts references", () => {
    expect(
      classifyTransaction({ ...base, merchantReference: "S-abcDEF0123456789wxyz-1" }, config),
    ).to.equal("other-environment");
    // A sale started on the terminal itself carries Wallee's own id.
    expect(classifyTransaction({ ...base, merchantReference: "608434636" }, config)).to.equal(
      "unmatched",
    );
  });

  it("refuses a foreign currency", () => {
    expect(classifyTransaction({ ...base, currency: "EUR" }, config)).to.equal(
      "amount-mismatch",
    );
  });
});
