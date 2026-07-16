// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Shard selection for the Playwright e2e configs (issue #530).
//
// CI splits the checkout suite across parallel runners, each with its own
// emulator and its own `globalSetup`. Playwright's native `--shard` can't be
// threaded through the nested `npm run` → `emulators:exec` → `playwright test`
// chain (npm doesn't forward `--` args across nested runs), so the shard
// arrives as the `PLAYWRIGHT_SHARD` env var instead and is applied via the
// config's `shard` option.
//
// Parsing is strict on purpose: a malformed value must fail the run loudly.
// Silently falling back to "no shard" would let a typo turn into a shard that
// quietly tests nothing while CI stays green.

export interface Shard {
  current: number;
  total: number;
}

/**
 * Parses a `PLAYWRIGHT_SHARD` value of the form "current/total" (1-based).
 *
 * Returns `undefined` when unset or empty — the local default, meaning "run
 * the whole suite". Throws on anything else.
 */
export function parseShard(value: string | undefined): Shard | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `PLAYWRIGHT_SHARD must look like "2/4" (current/total), got "${value}"`,
    );
  }

  const current = Number(match[1]);
  const total = Number(match[2]);

  if (total < 1) {
    throw new Error(`PLAYWRIGHT_SHARD total must be >= 1, got "${value}"`);
  }
  if (current < 1 || current > total) {
    throw new Error(
      `PLAYWRIGHT_SHARD current must be within 1..${total}, got "${value}"`,
    );
  }

  return { current, total };
}
