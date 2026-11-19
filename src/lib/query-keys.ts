// Query keys shared by more than one component; a key is also the prefix callers invalidate.
export const NICKNAMES_KEY = ["list_nicknames"] as const;
export const TRANSACTIONS_KEY = ["list_transactions"] as const;
export const CATEGORIES_KEY = ["list_categories"] as const;
export const JOB_STATUS_KEY = ["job_status"] as const;
export const OLLAMA_STATUS_KEY = ["ollama_status"] as const;
export const OLLAMA_SETTINGS_KEY = ["ollama_settings"] as const;
export const REVIEW_GROUPS_KEY = ["review_groups"] as const;
export const UNREVIEWED_COUNT_KEY = ["unreviewed_count"] as const;
export const BUILDS_KEY = ["list_builds"] as const;
export const STARTUP_STATUS_KEY = ["startup_status"] as const;
export const UPDATE_STATUS_KEY = ["update_status"] as const;
export const RELEASE_NOTES_KEY = ["release_notes"] as const;
