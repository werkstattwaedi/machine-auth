// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import * as sinon from "sinon";
import { HttpsError } from "firebase-functions/v2/https";
import { sendInviteMail } from "./invite";
import type { sendTemplate } from "../util/resend_template";

const params = {
  to: "invitee@example.com",
  variables: {
    INVITER_NAME: "Mira",
    MEMBERSHIP_NAME: "Familie Mira",
    ACCEPT_LINK: "https://example.com/account/invite/m/i",
  },
  context: { membershipId: "m", inviteId: "i" },
};

function failingSend(err: unknown, logError: sinon.SinonStub) {
  const send = (async () => {
    throw err;
  }) as unknown as typeof sendTemplate;
  return { send, logError };
}

describe("sendInviteMail", () => {
  let errorLog: sinon.SinonStub;

  beforeEach(() => {
    errorLog = sinon.stub();
  });

  it("does not page for a recipient the mail provider refused", async () => {
    await sendInviteMail(
      params,
      failingSend(
        new HttpsError("invalid-argument", "Ungültige E-Mail-Adresse."),
        errorLog,
      ),
    );
    expect(errorLog.called).to.be.false;
  });

  it("logs any other send failure as an error and still resolves", async () => {
    await sendInviteMail(
      params,
      failingSend(new HttpsError("internal", "Email send failed"), errorLog),
    );
    expect(errorLog.calledOnce).to.be.true;
  });
});
