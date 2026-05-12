// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import type { CfEntry } from "./schema_types";

/**
 * Thin wrapper over the CognitoForms REST API. Only the subset we need:
 *
 * - `GET /forms/{formId}/entries?$filter=...&$top=...&$orderby=...&$skip=...`
 *
 * Authentication is a JWT-style API key in the `Authorization: Bearer ...`
 * header (Custom Integration → API Key in CognitoForms admin).
 */

const DEFAULT_BASE_URL = "https://www.cognitoforms.com/api";

export interface CognitoformsClientOptions {
  apiKey: string;
  /** Override for tests. */
  baseUrl?: string;
  /** Override for tests (e.g. nock stub). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface ListEntriesQuery {
  /** OData $filter expression — server-side filter, optional. */
  filter?: string;
  /** OData $orderby. Defaults to `Entry.DateSubmitted asc`. */
  orderBy?: string;
  /** Page size. CognitoForms hard cap is 100. */
  top?: number;
  /** Pagination offset. */
  skip?: number;
}

export class CognitoformsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CognitoformsClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Fetch one page of entries. Caller paginates by adjusting `skip`.
   * Returns the parsed JSON array as `CfEntry[]`.
   */
  async listEntries(
    formId: string,
    query: ListEntriesQuery = {},
  ): Promise<CfEntry[]> {
    const params = new URLSearchParams();
    if (query.filter) params.set("$filter", query.filter);
    params.set("$orderby", query.orderBy ?? "Entry.DateSubmitted asc");
    params.set("$top", String(query.top ?? 100));
    params.set("$skip", String(query.skip ?? 0));
    const url = `${this.baseUrl}/forms/${formId}/entries?${params.toString()}`;

    const body = await this.requestWithRetry(url);
    if (!Array.isArray(body)) {
      throw new Error(
        `Unexpected /entries response shape (expected array, got ${typeof body}).`,
      );
    }
    return body as CfEntry[];
  }

  /**
   * Async iterator across every page until the API returns fewer than
   * `pageSize` results (or `maxEntries` is reached). Yields one entry at a
   * time so the orchestrator can batch-write without buffering the whole
   * history in memory.
   */
  async *iterateEntries(
    formId: string,
    query: Omit<ListEntriesQuery, "skip"> & { maxEntries?: number } = {},
  ): AsyncGenerator<CfEntry> {
    const pageSize = query.top ?? 100;
    let skip = 0;
    let yielded = 0;
    while (true) {
      const page = await this.listEntries(formId, {
        filter: query.filter,
        orderBy: query.orderBy,
        top: pageSize,
        skip,
      });
      for (const entry of page) {
        yield entry;
        yielded += 1;
        if (query.maxEntries != null && yielded >= query.maxEntries) {
          return;
        }
      }
      if (page.length < pageSize) return;
      skip += page.length;
    }
  }

  private async requestWithRetry(url: string): Promise<unknown> {
    const maxAttempts = 4;
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
      });
      if (res.ok) {
        return await res.json();
      }
      const text = await safeReadBody(res);
      lastError = new Error(
        `CognitoForms ${res.status} on GET ${url}: ${text.slice(0, 200)}`,
      );
      // Retry on 429 and 5xx with exponential backoff; bail on 4xx-other.
      if (res.status !== 429 && res.status < 500) {
        throw lastError;
      }
      const delayMs = Math.min(8000, 250 * 2 ** (attempt - 1));
      logger.warn("CognitoForms request retrying", {
        url,
        status: res.status,
        attempt,
        delayMs,
      });
      await sleep(delayMs);
    }
    throw lastError ?? new Error("CognitoForms request failed");
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable>";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
