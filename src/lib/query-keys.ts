import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { QueryChange } from "@/types/ui";

// Hierarchical query keys: the leaf is the command name, and a key is also the prefix that invalidates
// everything under it. Every view derived from the ledger (the rows and anything counted from them) goes
// under LEDGER_KEY, so one change refreshes them all. Components never invalidate keys themselves: they
// call invalidate(client, change).
export const LEDGER_KEY = ["ledger"] as const;
export const TRANSACTIONS_KEY = [...LEDGER_KEY, "list_transactions"] as const;
export const CATEGORIES_KEY = [...LEDGER_KEY, "list_categories"] as const;
export const NICKNAMES_KEY = [...LEDGER_KEY, "list_nicknames"] as const;
export const REVIEW_GROUPS_KEY = [...LEDGER_KEY, "review_groups"] as const;
export const UNREVIEWED_COUNT_KEY = [...LEDGER_KEY, "unreviewed_count"] as const;
export const RULE_MATCHES_KEY = [...LEDGER_KEY, "count_rule_matches"] as const;

export const OLLAMA_KEY = ["ollama"] as const;
export const OLLAMA_STATUS_KEY = [...OLLAMA_KEY, "ollama_status"] as const;
export const BUILDS_KEY = [...OLLAMA_KEY, "list_builds"] as const;
export const BUILD_PREVIEW_KEY = [...OLLAMA_KEY, "build_preview"] as const;

export const SECURITY_STATUS_KEY = ["security_status"] as const;
export const APP_INFO_KEY = ["app_info"] as const;
export const ACCOUNTS_KEY = ["list_accounts"] as const;
export const IMPORTS_KEY = ["list_imports"] as const;
export const CSV_LAYOUTS_KEY = ["list_csv_layouts"] as const;
export const CSV_PREVIEW_KEY = ["preview_csv_mapping"] as const;
export const NICKNAME_SETTINGS_KEY = ["nickname_settings"] as const;
export const BACKUP_SETTINGS_KEY = ["backup_settings"] as const;
export const BACKUPS_KEY = ["list_backups"] as const;
// Outside OLLAMA_KEY: every save writes the answer here, so an "ollama" change must not re-read a stale copy.
export const OLLAMA_SETTINGS_KEY = ["ollama_settings"] as const;
export const JOB_STATUS_KEY = ["job_status"] as const;
export const STARTUP_STATUS_KEY = ["startup_status"] as const;
export const UPDATE_STATUS_KEY = ["update_status"] as const;
export const RELEASE_NOTES_KEY = ["release_notes"] as const;

// What each change makes stale. `null` means every query.
const STALE: Record<QueryChange, readonly QueryKey[] | null> = {
  // A category's name, order or existence, or a row's category: rows, counts, review groups, nickname defaults.
  category: [LEDGER_KEY],
  // Nicknames rename rows and set their default categories.
  nickname: [LEDGER_KEY],
  import: [LEDGER_KEY, IMPORTS_KEY],
  // The review page already dropped the reviewed groups from its own data, so they aren't re-read.
  review: [UNREVIEWED_COUNT_KEY, TRANSACTIONS_KEY],
  // Everything may have changed, including whether Zeni is locked.
  restore: null,
  security: [SECURITY_STATUS_KEY],
  csvLayouts: [CSV_LAYOUTS_KEY],
  backups: [BACKUPS_KEY],
  // Installed models, builds and the build preview.
  ollama: [OLLAMA_KEY],
  // A finished download can also change the base model.
  download: [OLLAMA_KEY, OLLAMA_SETTINGS_KEY],
  // After starting, cancelling or clearing a job, so every banner, action and card sees it.
  job: [JOB_STATUS_KEY],
};

export async function invalidate(client: QueryClient, change: QueryChange): Promise<void> {
  const keys = STALE[change];
  if (keys === null) return client.invalidateQueries();
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}
