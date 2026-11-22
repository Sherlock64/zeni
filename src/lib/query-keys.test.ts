import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import * as keys from "@/lib/query-keys";
import type { QueryChange } from "@/types/ui";

const { invalidate, LEDGER_KEY: _ledger, OLLAMA_KEY: _ollama, ...leaves } = keys;

// Seeds one cached query per key (and a parameterised transactions page), invalidates, and lists what went stale.
async function staleAfter(change: QueryChange) {
  const client = new QueryClient();
  const seeded = { ...leaves, TRANSACTIONS_PAGE: [...keys.TRANSACTIONS_KEY, { page: 2 }] };
  for (const key of Object.values(seeded)) client.setQueryData(key, 1);
  await invalidate(client, change);
  return Object.entries(seeded)
    .filter(([, key]) => client.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
    .sort();
}

const LEDGER = [
  "CATEGORIES_KEY",
  "NICKNAMES_KEY",
  "REVIEW_GROUPS_KEY",
  "RULE_MATCHES_KEY",
  "TRANSACTIONS_KEY",
  "TRANSACTIONS_PAGE",
  "UNREVIEWED_COUNT_KEY",
];

test.each<[QueryChange, string[]]>([
  // Fixed: deleting a category used to skip the review groups (and the unreviewed count).
  ["category", LEDGER],
  ["nickname", LEDGER],
  ["import", [...LEDGER, "IMPORTS_KEY"].sort()],
  ["review", ["TRANSACTIONS_KEY", "TRANSACTIONS_PAGE", "UNREVIEWED_COUNT_KEY"]],
  ["restore", Object.keys(leaves).concat("TRANSACTIONS_PAGE").sort()],
  ["security", ["SECURITY_STATUS_KEY"]],
  ["csvLayouts", ["CSV_LAYOUTS_KEY"]],
  ["backups", ["BACKUPS_KEY"]],
  ["ollama", ["BUILDS_KEY", "BUILD_PREVIEW_KEY", "OLLAMA_STATUS_KEY"]],
  ["download", ["BUILDS_KEY", "BUILD_PREVIEW_KEY", "OLLAMA_SETTINGS_KEY", "OLLAMA_STATUS_KEY"]],
  ["job", ["JOB_STATUS_KEY"]],
])("a %s change makes exactly these queries stale", async (change, expected) => {
  expect(await staleAfter(change)).toEqual(expected);
});
