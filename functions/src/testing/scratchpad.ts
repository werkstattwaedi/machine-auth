import { ByteBuffer } from "flatbuffers";
import { diversifyKey } from "../ntag/key_diversification";
import { generateEncodedStartSessionRequest } from "./test_utils";
import { toKeyBytes } from "../ntag/bytebuffer_util";
import * as crypto from "crypto";
import { api } from "..";

// Call your function here with test data
const machineId = "test-machine-123";
const tokenId = [1, 2, 3, 4, 5, 6, 7];
const testMasterKey = "000102030405060708090a0b0c0d0e0f";
const testSystemName = "OwwMachineAuth";

const tagChallenge = [
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
];

const authKey = diversifyKey(
  testMasterKey,
  testSystemName,
  Buffer.from(tokenId),
  "authorization"
);

const cipher = crypto.createCipheriv(
  "aes-128-cbc",
  toKeyBytes(authKey),
  Buffer.alloc(16, 0)
);
cipher.setAutoPadding(false);

const encryptedTagChallenge = Buffer.concat([
  cipher.update(Buffer.from(tagChallenge)),
  cipher.final(),
]);

// console.log(encryptedTagChallenge);

const encodedRequest = generateEncodedStartSessionRequest(
  machineId,
  tokenId,
  Array.from(encryptedTagChallenge)
);

// start env
// npm run build:watch
// firebase emulators:start --only database,firestore,hosting,pubsub
// firebase functions:shell

// Generate with
// functions$ npx ts-node src/testing/scratchpad.ts

// paste output in shell
console.log(
  `api.post("/startSession", ${JSON.stringify({
    body: {
      id: "123",
      data: encodedRequest,
    },
    json: true,
    headers: {
      Authorization: `Bearer SuperSecr3t`,
    },
  })})`
);


console.log(
  `particle publish terminalRequest '{"id":"123", "method": "startSession", "data": "EAAAAAwAEwATAAwACwAEAAwAAAAcAAAAAAAAATAAAAAAAAABAgMEBQYHBgAIAAQABgAAAAQAAAAQAAAArLrsTDWA0D1qQNOozMPyKRAAAAB0ZXN0LW1hY2hpbmUtMTIzAAAAAA=="}'`
);
