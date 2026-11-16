# Personal Finance App — V6 PRD: Categorization

V6 gives each transaction a category from a flat, editable list. A local Ollama model picks from that list, the user can override any row and add a note, nicknames can carry a default category, a review page confirms the model's answers in groups, model builds teach the model from reviewed rows, and one shared spending query applies the transfer and refund rules for V8. Raw rows are never changed. Builds on PRD-V1.md to PRD-V5.1.md; see ROADMAP.md.

**Effective category** of a row, used everywhere below: the user's category if set by user, else its nickname's default category, else the model's answer, else uncategorized.

## User Stories

### S1: Categories
As a user, I want my own list of categories, so that transactions are grouped the way I think about money.

- **S1-T1** (backend; deps: none): a `categories` table (name, description, kind `spending` | `income` | `transfer`, sort order) seeded with the approved starter list, with list, add, edit, reorder and delete commands.
  - A fresh database lists about 20 starter categories in order, each with a description, including income categories and a "Savings transfer" category of kind `transfer`.
  - Names are trimmed, 1-40 characters and unique ignoring case; descriptions are trimmed, 0-200 characters; violations return a field error and store nothing.
  - Reorder stores the new order, and list returns it.
  - Delete reports how many rows and nicknames use the category. With a replacement, those rows move to it keeping who set them and their reviewed state, and nickname defaults move to it; with none, the rows become uncategorized and the defaults are cleared.
  - A kind change keeps the rows on the category; the S8 query reflects the new kind at once.
  - Add, edit, reorder and delete are refused while a categorize run is going.
- **S1-T2** (UI; deps: S1-T1): a Categories page in the sidebar with add, edit, delete and drag-to-reorder using `@dnd-kit/core` and `@dnd-kit/sortable` (approved dependencies).
  - Reordering works by mouse and by keyboard, with screen-reader announcements.
  - The description field hints that a good description helps the model.
  - Deleting a used category opens a dialog showing the row and nickname counts and offering a replacement or "Leave uncategorized".
  - During a run every edit control is disabled with "Wait for categorizing to finish".

### S2: Set a category and note myself
As a user, I want to set or clear a row's category and add a note, so that I can fix and annotate any transaction.

- **S2-T1** (backend; deps: S1-T1): a per-transaction overlay (at most one row per raw transaction, deleted with it) holding category, note, set by (`model` | `nickname` | `user`), reviewed and updated date; set and clear commands; the transaction list returns effective category, set by, reviewed and note, filters by category or uncategorized, and searches notes.
  - Saving with a category stores it as set by user and reviewed, even when it equals the model's answer.
  - Choosing "Uncategorized" clears the category and the user mark and keeps the note; the row is then uncategorized and open to the model.
  - Notes are trimmed, 0-500 characters; empty means no note; longer returns a field error.
  - Reverting an import deletes its overlay rows; raw rows are never updated.
- **S2-T2** (UI; deps: S2-T1): on Transactions, a Category column with a set-by marker (model, nickname, you) and a dot for unreviewed model rows, a note icon with the note as tooltip, a category filter including "Uncategorized", and a Categorize dialog (category picker and note) opened from the Category cell or right-click "Categorize…".

### S3: Connect Ollama
As a user, I want Zeni to find my local Ollama and help me get a model, so that categorizing works without a cloud service.

- **S3-T1** (backend; deps: none): the Ollama client using `reqwest` (approved dependency; rustls, default features off) at `http://127.0.0.1:<port>`; port setting (1-65535, default 11434); status (reachable, version); installed models; the recommended model list with sizes and notes; model download with progress and cancel; base model setting.
  - Only the loopback address is ever contacted; a port outside 1-65535 returns a field error.
  - With Ollama stopped, status reports unreachable and every other command keeps working.
  - A download reports bytes done and total, runs while the app is open, and stops on cancel or app exit; finishing sets the model as the base model.
  - Only one Ollama job (run, download or build) runs at a time; starting another returns a busy error naming the running job.
- **S3-T2** (UI; deps: S3-T1): an Ollama card in Settings with port, status, the base model picker over installed models, and the recommended list with size, note and "Installed" badge.
  - Unreachable or no models: the card explains what to do and shows a copyable `ollama pull <model>`.
  - Picking a missing recommended model asks "Download <model> (<size>)?", then shows a progress bar with Cancel, which reappears when Settings is reopened mid-download (RUNTIME).

### S4: Categorize with the model
As a user, I want the model to categorize my transactions in the background, so that I don't have to do every row by hand.

- **S4-T1** (backend; deps: S2-T1, S3-T1): a `Categorizer` trait (categorize rows against a category list) with an Ollama implementation and a fake for tests; "Categorize now" (uncategorized rows) and "Recategorize all" (every row not set by user or nickname) runs with progress, cancel and a summary; auto-categorize after import (setting, on by default).
  - One request per row, using the active build or else the base model, sending the nickname, description, memo, signed amount and CSV bank category (when present) with every category's name, kind and description; the answer is limited by a JSON-schema enum of category names, temperature 0.
  - An answer not on the list is never stored; it is retried once, then the row stays uncategorized and counts as "couldn't categorize".
  - Stored answers are set by model and unreviewed, recording the build used; rows set by user or nickname are never sent.
  - Cancel keeps finished rows and leaves the rest untouched; a row deleted mid-run is skipped. If Ollama stops responding (after one retry) the run stops and the summary says after how many rows.
  - Summary counts: categorized, couldn't categorize, not reached.
  - With Ollama unreachable, no base model or another job running, the import still commits and returns a notice instead of starting the run.
- **S4-T2** (UI; deps: S4-T1): "Categorize now" and "Recategorize all" (confirm first) on Transactions; a banner "Categorizing <done> of <total>" with Cancel that persists across navigation; the summary; the post-import notice; the auto-categorize switch in Settings.
  - The buttons are disabled with the reason when Ollama is unreachable, no model is picked or a job is running.

### S5: Nickname default category
As a user, I want a nickname to set a category for its rows, so that known merchants never need the model.

- **S5-T1** (backend; deps: S2-T1): nicknames gain an optional default category (cleared if the category is deleted without replacement).
  - Rows whose winning nickname has a default show it as set by nickname and count as reviewed; the model is never asked about them.
  - They follow later changes: a new default, new matches or a changed rule; removing the default, disabling or deleting the nickname makes them uncategorized.
  - Rows set by user keep their category.
- **S5-T2** (UI; deps: S5-T1): a default category picker on the Nicknames page and in the Rename dialog.

### S6: Review
As a user, I want to confirm the model's answers a group at a time, so that reviewing is fast.

- **S6-T1** (backend; deps: S4-T1): the unreviewed model rows grouped by category in category order, the unreviewed count, and a command that marks one group reviewed.
- **S6-T2** (UI; deps: S6-T1): a Review page in the sidebar with the unreviewed count as a badge and collapsible groups; changing a row's category sets it as set by user and reviewed and moves it out of the group; "Looks good" marks the rest of the group reviewed.

### S7: Model builds
As a user, I want to build a model from my reviewed rows, so that it learns my choices.

- **S7-T1** (backend; deps: S6-T1): a builds table (name `zeni-<number>`, base model, created date, example count, active, out of date); build, activate and delete commands; examples-per-category setting (1-20, default 5).
  - Examples come from rows set by user, set by nickname, or set by model and reviewed: up to N per category, newest first, taking distinct nicknames or descriptions before repeats. Example: N = 2 and Groceries has reviewed rows (newest first) "Fresh Mart", "Fresh Mart", "Corner Shop" → "Fresh Mart" and "Corner Shop".
  - A build creates the model through Ollama's `/api/create` with `from` (the base model), `system` (the category list) and `messages` (example pairs), and stores what it sent; with no examples at all, build is refused.
  - Exactly one build or none is active; with none, the base model is used. Picking a base model deactivates the active build.
  - Any category add, edit, reorder or delete after a build marks it out of date; it stays active.
  - Delete removes the build from Ollama and the list; deleting the active build falls back to the base model.
- **S7-T2** (UI; deps: S7-T1): a Model builds section in the Ollama card listing builds with base model, date, example count and Active / Out of date badges, with Build, Make active, Delete (confirm) and the examples setting; "Rebuild" is suggested when the active build is out of date.

### S8: Spending rules
As a user, I want transfers and refunds counted correctly, so that later dashboards show real spending.

- **S8-T1** (backend; deps: S2-T1, S5-T1): one shared query over a date range returning, by effective category, spending, income and an uncategorized bucket.
  - spending = −Σ amount over rows in `spending` categories; a refund reduces it. Example: −5,000 and +1,000 cents in Groceries → spending 4,000.
  - income = Σ amount over rows in `income` categories. Example: +300,000 and −20,000 → income 280,000.
  - Rows in `transfer` categories count in neither.
  - Uncategorized rows return their own count and Σ amount.

## Decisions

- All of the roadmap's V6 ships in one version, model builds included.
- Categories are flat, each with a kind; American spelling throughout.
- Starter list of about 20 editable categories, approved at a checkpoint.
- Categories page with drag reorder (`@dnd-kit`); kind changes apply at once without a confirm.
- Deleting a used category asks for a replacement or leaves rows uncategorized.
- Saving a category in the dialog marks it set by user and reviewed; "Uncategorized" returns the row to the model.
- Notes are searchable.
- Ollama on loopback only via `reqwest`; Zeni recommends models (list approved at a checkpoint) and can download them.
- One row per model request; one Ollama job at a time; the category editor locks during a run.
- Two actions, "Categorize now" and "Recategorize all", plus auto-categorize after import (on by default).
- A failing Ollama stops the run.
- Nickname-set rows follow their nickname and count as reviewed.
- Review is its own page with a count badge.
- Build examples include nickname-set rows; at least one example is required.
- Out-of-date builds stay active; picking a base model deactivates the active build.
- Spending query keeps uncategorized as a separate bucket; income is a signed sum.

## New Terms

- **Category**: one entry of the user's flat category list, with a kind.
- **Kind**: `spending`, `income` or `transfer`; decides how a category counts in the spending query.
- **Effective category**: the category a row shows: set by user, else nickname default, else model, else uncategorized.
- **Set by**: who set a row's category: `model`, `nickname` or `user`.
- **Reviewed**: a model answer the user confirmed; user- and nickname-set rows count as reviewed.
- **Categorizer**: the backend that picks a category for a row; V6 ships the Ollama one.
- **Base model**: the installed Ollama model chosen in Settings.
- **Model build**: an Ollama model `zeni-<number>` made from the base model, the category list and reviewed examples.
- **Active build**: the model build used for categorizing; with none, the base model.
- **Categorize run**: one background "Categorize now", "Recategorize all" or post-import pass.

## Out of Scope

- Dashboards and charts (V8); budget links (V11).
- Other categorizer backends (Jev, Unsloth fine-tuning).
- Split transactions; nested categories; bulk setting a category on selected rows.
- Remote Ollama hosts.

## Checkpoint

- Before writing the migration that seeds categories, stop and show the user the starter list (names, kinds, descriptions) for approval.
- Before fixing the recommended model list, stop and show the user 3-4 small candidates tried on `samples/` (accuracy, speed, download size) for approval.
