// Mirror the backend limits in src-tauri/src/nicknames.rs; the backend still validates.
/** Max characters in a nickname name: `MAX_NAME_CHARS`. */
export const NICKNAME_MAX_LEN = 100;
/** Max characters in a rule pattern: `MAX_PATTERN_CHARS`. */
export const PATTERN_MAX_LEN = 500;
/** Stale days range: `1..=MAX_STALE_DAYS`. */
export const STALE_DAYS_MIN = 1;
export const STALE_DAYS_MAX = 3650;
