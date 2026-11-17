# 0001: Derived effective category and polled single job slot

## Context
V6 gives each transaction a category. Three sources can set it: the user, a nickname's default and the Ollama model. The user must be able to change a nickname default and see every matching row follow at once. Categorizing also runs for minutes in the background, shares Ollama with downloads and builds, and must survive page changes.

## Decision
- **Overlay.** `transaction_categories` stores only the user's answer (`user_category_id`), the model's answer (`model_category_id`, `model_build_id`, `model_reviewed`) and the note. A nickname's default is never copied into it.
- **View.** The `effective_categories` view computes the effective category as user, then the default of the enabled winning nickname, then model. It also derives set by and reviewed. The list, review, build examples and spending all read it.
- **Rebuild clears model answers.** At the end of `nicknames::rebuild` (every nickname and rule change), the model columns of every row whose enabled winning nickname has a default are cleared. Removing the default later leaves those rows uncategorized, not back on an old model answer.
- **Guarded model write.** A model answer is written by one `INSERT ... ON CONFLICT` statement that stores it only while the row exists, the category exists and the effective set by is neither `user` nor `nickname`. A user edit, a new default or a deleted row that lands mid-run wins; a skipped row counts as neither categorized nor failed.
- **One polled job slot.** At most one Ollama job runs: a categorize run, a download or a build. Its state lives in `AppState.jobs`. The UI reads it through `job_status` (about every 500 ms while a job runs, otherwise on mount). There are no Tauri events.
- **Restore waits.** `restore_backup` and undo restore call `jobs::stop_and_wait` before swapping the database. App exit sets cancel. A job holds a pool clone taken at start and never re-reads `AppState.db`.

## Alternatives
- **Materialized defaults.** Copy a nickname's default into the overlay when it is set or matches. Rejected: the copy drifts. A changed rule, a disabled or deleted nickname, a removed default or a new import would each need a fix-up pass to keep the copy right, and a missed one shows a wrong category with no way to tell it from a user's choice.
- **Tauri events for progress.** Rejected: the UI must show the state after a reload or after navigating away, so it needs a readable state anyway; polling that state is enough.
- **Several jobs at once.** Rejected: one local Ollama gains nothing from parallel requests, and a single slot gives each busy error one running job to name.

## Consequences
- A default change takes effect with no data migration, and set by can never be stale.
- Every reader must go through the view; reading the overlay directly gives wrong answers.
- Each list query joins the view; revisit if the list gets slow on large databases.
- Progress updates lag by up to the poll interval. Revisit with events if a second long job type needs push updates.

## Status
Accepted (V6).
