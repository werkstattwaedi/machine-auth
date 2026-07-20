// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Invoice-PDF escrow move (ADR-0038, Phase 3 infrastructure).
 *
 * Trim and erasure MOVE invoice PDFs from the default bucket into the
 * locked archive bucket `<project>-invoice-archive` instead of deleting
 * them — OR Art. 958f requires 10-year retention, but an app-readable PDF
 * would let the (date, amount) join re-identify BigQuery subject keys.
 * The functions SA holds `objectCreator` ONLY on the archive (write,
 * never read); reading archived PDFs is a break-glass IAM grant.
 *
 * Idempotency: the copy uses `ifGenerationMatch: 0` — a 412 means the PDF
 * already sits in the archive (crash between copy and source delete), and
 * the move proceeds to delete the source. `customTime` is stamped with the
 * bill's paid date so the bucket lifecycle rule (`daysSinceCustomTime ≈
 * 3650`) expires the archive on the legal schedule, not the move date.
 */

import { getApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

export function archiveBucketName(): string {
  const projectId =
    getApp().options.projectId ??
    process.env.GCLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Cannot determine project id for the archive bucket");
  }
  return `${projectId}-invoice-archive`;
}

export type ArchiveResult = "archived" | "source-missing";

export async function moveInvoicePdfToArchive(
  storagePath: string,
  customTime: Date
): Promise<ArchiveResult> {
  const storage = getStorage();
  const source = storage.bucket().file(storagePath);
  const [sourceExists] = await source.exists();
  if (!sourceExists) {
    return "source-missing";
  }
  const dest = storage.bucket(archiveBucketName()).file(storagePath);
  const [contents] = await source.download();
  try {
    await dest.save(contents, {
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { customTime: customTime.toISOString() },
      resumable: false,
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 412) throw err;
    // 412: already archived by a previous (crashed) run — fall through.
  }
  try {
    await source.delete();
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 404) throw err;
    // 404: a concurrent move (trim vs erasure racing on the same bill)
    // already deleted the source — the outcome we wanted either way.
  }
  return "archived";
}
