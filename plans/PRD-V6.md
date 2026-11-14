# Personal Finance App — V6 PRD: Categorisation

V6 categorises transactions with a local Ollama model constrained to the user's category list, with review, user overrides, nickname defaults and few-shot model builds. Builds on PRD-V1.md to PRD-V5.md; see ROADMAP.md.

## Requirements

- **V6-R1:** Categories table (flat): ID, name (unique), description, kind (`spending`, `income`, `transfer`), sort order. Ships a curated starter list of about 20 with descriptions, including income and a "Savings transfer" transfer category, all editable. Category editor page: add, edit, reorder, delete. Deleting a category in use asks for a replacement or leaves those rows uncategorised.
- **V6-R2:** Transaction overlay table, one row per raw transaction at most (`ON DELETE CASCADE` from the raw row): category ID, note, set by (`model`, `nickname`, `user`), reviewed, model build ID (when set by a model), updated date. Raw rows are never changed.
- **V6-R3:** Ollama integration over HTTP with `reqwest` (approved dependency; rustls, default features off). Endpoint is `http://127.0.0.1:<port>`, port in Settings, default 11434; non-loopback hosts are refused. Settings shows whether Ollama is reachable, lists installed models, and picks the base model.
- **V6-R4:** Prompts send the nickname (if any), description, memo, amount, and the CSV bank category as a hint (when present), plus the category list with descriptions. The answer is constrained by Ollama's JSON-schema `format` with an enum of category names, temperature 0. An answer not on the list is rejected and retried once; a second failure leaves the row uncategorised and counts as "couldn't categorise".
- **V6-R5:** Actions on the Transactions page: "Categorize now" (uncategorised rows), "Categorize all" (all rows not set by the user), "Recategorize all" (same scope, after a confirm; skips user-set rows). A Settings switch, on by default, categorises new rows after each import. Runs in the background with progress and cancel; a summary shows counts.
- **V6-R6:** Nickname default category: nicknames gain an optional default category (`ON DELETE SET NULL`); matching rows get it with set by `nickname`, and the model is skipped for them. Changing the default updates those rows unless set by the user.
- **V6-R7:** Users can set a row's category and note from the list (right-click or a cell control); this sets set by `user` and reviewed.
- **V6-R8:** Batch review screen: unreviewed model-set rows grouped by category; change any row's category; "Looks good" marks a whole group reviewed.
- **V6-R9:** Model builds: a builds table (ID, name, base model, created date, example count, active). A build generates a Modelfile with a system prompt holding the category list and up to N reviewed examples per category as `MESSAGE` pairs (N in Settings, default 5; newest first, preferring distinct nicknames or descriptions), stored in the builds table, and created through Ollama's `/api/create` using the equivalent `from`, `system` and `messages` fields (the raw `modelfile` field is deprecated). One build is active; with none, the base model is used.
- **V6-R10:** Spending rules: rows in `transfer` categories are excluded from spending; a positive amount in a `spending` category counts as negative spending (a refund). Exposed as one SQL view or query helper that V8 (Dashboard) will use.
- **V6-R11:** Pluggable categoriser: a Rust `Categoriser` trait (categorise a batch against a category list) with an Ollama implementation; tests use a fake.
- **V6-R12:** Transaction list shows the category and lets the user filter by category, including uncategorised.

## Out of Scope

- Dashboards and charts (V8); budget links (V11).
- Other categoriser backends (Jev, Unsloth fine-tuning).
- Split transactions; nested categories.
- Remote Ollama hosts.

## Edge Cases

- **Ollama not running or no model picked:** actions are disabled with an explanation; the import still succeeds.
- **Category list changes after a build:** the active build is marked out of date and a rebuild is suggested; answers are still checked against the current list.
- **Fewer than N reviewed examples:** the build uses what exists; a category with none gets no examples.
- **Reverting an import:** its overlay rows are deleted with its raw rows.
- **Cancel mid-run:** rows already categorised stay; the rest are untouched.

## Checkpoint

- Stop and show the user the starter category list (names, kinds, descriptions) for approval before writing the migration that seeds it.

## Acceptance Criteria

1. With Ollama running, Settings lists installed models and saves the chosen base model; with it stopped, the app explains and keeps working.
2. "Categorize now" fills only uncategorised rows; "Recategorize all" never changes user-set rows.
3. Out-of-list answers are rejected and never stored (covered by tests with the fake categoriser).
4. Rows matching a nickname with a default category get it without a model call.
5. The review screen groups by category and "Looks good" marks the group reviewed; user edits set set by `user`.
6. A build creates an Ollama model from a generated Modelfile with at most N examples per category, and it can be made active.
7. Transfer rows are excluded from spending and refunds reduce it, in the shared spending query (covered by tests).
8. Only loopback Ollama endpoints are accepted.
9. Raw transaction rows are never modified.
