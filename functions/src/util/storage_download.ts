// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Emulator-aware helpers for PDF objects in Cloud Storage.
 *
 * Production hands out V4 signed URLs. Those cannot be produced against the
 * Storage emulator: signing needs a service-account private key that the
 * emulator environment doesn't have (`getSignedUrl` throws "Cannot sign data
 * without client_email"). In emulator mode we instead attach a Firebase
 * download token at save time and resolve the URL via `getDownloadURL`,
 * which is emulator-aware — so the admin/checkout dev flows and the
 * integration tests exercise a URL that actually serves the bytes.
 */

import { randomUUID } from "node:crypto";
import type { File, SaveOptions } from "@google-cloud/storage";

function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

/**
 * Options for `file.save(...)` of a generated PDF. In emulator mode this
 * includes a download token so `downloadUrlFor` can mint a fetchable URL.
 */
export function pdfSaveOptions(): SaveOptions {
  const options: SaveOptions = { contentType: "application/pdf" };
  if (isEmulator()) {
    options.metadata = {
      metadata: { firebaseStorageDownloadTokens: randomUUID() },
    };
  }
  return options;
}

export interface SignedDownloadOptions {
  action: "read";
  expires: number;
  responseDisposition?: string;
}

/**
 * Resolve the user-facing download URL for a stored PDF: a signed URL in
 * production, the token download URL against the emulator.
 *
 * The emulator URL is built by hand instead of via firebase-admin's
 * `getDownloadURL`: that helper reads metadata through the rules-guarded
 * `/v0` endpoint and gets denied (the emulator's GCS JSON API, which the
 * rest of the Admin SDK uses, is auth-free). It also ignores
 * `responseDisposition` (no attachment filename) — acceptable for dev;
 * tests assert on content, not headers.
 */
export async function downloadUrlFor(
  file: File,
  options: SignedDownloadOptions,
): Promise<string> {
  if (isEmulator()) {
    const [metadata] = await file.getMetadata();
    const token = String(
      metadata.metadata?.firebaseStorageDownloadTokens ?? "",
    ).split(",")[0];
    const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199";
    const objectPath = encodeURIComponent(file.name);
    // Without a token the URL 403s under the deny-all rules — that only
    // happens for objects saved before pdfSaveOptions() existed (dev data).
    const tokenParam = token ? `&token=${token}` : "";
    return `http://${host}/v0/b/${file.bucket.name}/o/${objectPath}?alt=media${tokenParam}`;
  }
  const [url] = await file.getSignedUrl(options);
  return url;
}
