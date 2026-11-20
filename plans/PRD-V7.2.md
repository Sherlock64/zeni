# Personal Finance App — V7.2 PRD: Low Bug Cleanup

V7.2 closes all 26 open low-severity `factory-bug` issues before V8: small UI and copy fixes on the Review, Transactions, Settings and startup screens, shadcn components in place of hand-styled ones, backend tidy-ups in startup, updates, nicknames, Review and the data types, test fixes, a CI cache key, the `check.sh` task mode and one `write-prd` workflow change. It also carries some hardening fixes reviewed privately, and ships as release 7.2.0. It adds no feature and changes no data. Builds on PRD-V1.md to PRD-V7.1.md; see ROADMAP.md.

## User Stories

### Review page

### S1: Review page is split into components (#89, low)
As a developer, I want the Review page's long render split up, so that it reads at a glance.
- **S1-T1** (UI; deps: none): a group section component and a row component, their props types in the UI types module; the page renders them.
  - Review page tests pass unchanged; a snapshot shows no visual change.

### S2: "Select all like this" only where it's wanted (#92, low)
As a user, I want the per-row "Select all like this" button to show on row hover or focus, so that the list is less noisy.
- **S2-T1** (UI; deps: S1-T1): the button is visually hidden until its row is hovered or has focus inside; it stays in the tab order and shows when focused.
  - A test tabs to the button and it is focused and visible; pressing it still selects the matching rows.
  - A snapshot shows rows without the button at rest (`RUNTIME` for hover look).

### S3: Review categories-failure test waits for the rejection (#93, low)
As a developer, I want the categories-failure test to assert after the rejection settles, so that it can't pass early.
- **S3-T1** (UI; deps: S1-T1): the test awaits the error state before asserting no listbox.

### Categorize and Ollama UI

### S4: Clearer Ollama job wording, links and retry (#88, low)
As a user, I want the categorize actions to read naturally, point me to Settings and let me retry, so that I know what's happening and what to do.
- **S4-T1** (UI; deps: none): the job label reads "Building <model>…" or "Categorizing…"; the no-model reason links to Settings; "Couldn't check Ollama" on Transactions has a Try again button that refetches the status; the actions render nothing until the first status loads.
  - Tests for each: wording, the Settings link target, Try again refetching once, and no actions before the status resolves.

### S5: Progress bars use shadcn Progress (#87, low)
As a user, I want the progress bars to match the theme, so that they look like the rest of the app.
- **S5-T1** (UI; deps: none): the categorize banner and the Ollama card use the shadcn Progress component, built on the already-installed `radix-ui` package (no new dependency).
  - Each bar still exposes its value to assistive tech; tests pass; a snapshot shows both bars.

### S6: Note field uses shadcn Textarea (#86, low)
As a user, I want the note field in the categorize dialog to match the other inputs.
- **S6-T1** (UI; deps: none): the shadcn Textarea component is added and the note field uses it; the label still names it.

### S7: Not-found next step fits a dialog (#85, low)
As a user, I want a not-found error inside the categorize dialog to tell me something I can do there.
- **S7-T1** (UI; deps: none): the error alert takes the next-step copy from its caller where context needs it; in the categorize dialog a not-found error reads "Close this dialog and try again." Pages keep "Reload the page".
  - Tests for both copies.

### S8: Categorize banner shares Page's width (#90, low)
As a developer, I want one source for page width and padding, so that the banner and pages can't drift.
- **S8-T1** (UI; deps: S5-T1): one shared class constant used by Page and the banner; a snapshot shows no change.

### S9: Category form drops a needless export (#84, low)
- **S9-T1** (UI; deps: none): the file-local symbol is no longer exported; type-check passes.

### Nicknames and backups UI

### S10: Nickname rule legends use shared styling (#55, low)
- **S10-T1** (UI; deps: none): the Mode and Field legends use the shadcn Field component's legend (added through the shadcn CLI, no new package) instead of hand-written classes; a snapshot shows the same look.

### S11: Two-to-one rule test checks the whole menu (#62, low)
- **S11-T1** (UI; deps: none): after a delete leaves one rule, the test asserts the full nickname menu item list, as the single-rule test does.

### S12: Redundant backup list-retry test removed (#61, low)
- **S12-T1** (UI; deps: none): the older "shows a list error with a retry" test is dropped; the newer list-retry test still passes.

### Startup, updates and release notes

### S13: External links say they open the browser (#116, low)
As a screen-reader user, I want to hear that a link opens my browser, so that I know I'm leaving the app.
- **S13-T1** (UI; deps: none): "How to install Zeni" and the update banner's button carry screen-reader text "(opens in your browser)"; the banner button reads "Download Zeni <version>".
  - Tests find each accessible name with the suffix.

### S14: Release notes error can be retried (#122, low)
As a user, I want a failed Release notes load to offer Try again.
- **S14-T1** (UI; deps: none): the dialog's error alert has an outline Try again button that refetches; while refetching, more presses do nothing.
  - A test fails the load, presses Try again, and sees the notes; a second press during the retry fetches once.

### S15: Startup check is split into helpers (#119, low)
- **S15-T1** (backend; deps: S16-T1): the newer-data and backup decisions move into two small helpers; startup tests pass unchanged.

### S16: Startup drops its private problem enum (#118, low)
- **S16-T1** (backend; deps: none): the startup check returns the existing startup problem type directly; the private enum and its conversions are gone; startup tests pass.

### S17: Serialize errors convert in one place (#117, #104, low)
- **S17-T1** (backend; deps: none): one conversion from a JSON error to the app error lives in the types module, mapped to the database kind because both values are encoded for storage; updates and Review use `?` with no inline mapping.

### S18: No shadowed today (#125, low)
- **S18-T1** (backend; deps: none): the launch check's local date variable no longer shadows the `today` function.

### S19: Version test checks the format, not a number (#121, low)
- **S19-T1** (backend; deps: none): the version test asserts the app version parses, and that the `package.json` version equals the Cargo version; a version bump needs no test edit.

### Backend

### S20: Nicknames uses the shared app_meta read (#126, low)
- **S20-T1** (backend; deps: none): the stale-days setting reads through the shared `app_meta` helper; nickname tests pass.

### S21: Data structs live in types.rs (#83, low)
- **S21-T1** (backend; deps: S17-T1): the data structs in the categorize and Ollama modules move to the types module; bindings, if any, are unchanged.

### S22: Cancel regression fails instead of hanging (#91, low)
- **S22-T1** (backend; deps: S21-T1): the in-flight cancel test's fake waits a bounded time, so a regression fails the elapsed-time assertion rather than hanging.

### Model builds

### S27: Builds fit Ollama's context window
As a user, I want a model build to hold only as many examples as Ollama's context window fits, with an override, so that categorizing doesn't stall on an oversized build.
- **S27-T1** (backend; deps: none): the next build's examples are trimmed to the window by the rule below; a preview command reports the window, how many fit and how many the setting picks; a setting allows builds past the window.
  - Window W: the base model's `num_ctx` parameter in Ollama, else 4096.
  - Estimate est(text) = ceil(characters / 3). A message costs est(content) + 4; an example costs its user message plus its assistant message. A = ceil(mean example cost over all candidates). Budget B = W - (est(system prompt) + 4) - 5 x A.
  - Candidates are today's picks (examples per category, same order). Take them round by round: the 1st of each category in category order, then the 2nd of each, and so on; stop at the first one that would take the total over B. The first round is always taken whole, even past B.
  - Example: W = 4096, system prompt 1,800 chars (604), every example 100: A = 100, B = 2,992. 22 categories at 20 each: round 1 takes 22 (2,200), round 2 adds 7 (2,900); the 30th would make 3,000, so the build has 29.
  - Edge: 22 categories whose examples cost 200 each: round 1 alone is 4,400 > B, so the build has exactly those 22.
  - With "allow past the window" on, the build uses every candidate; the preview's fit count is unchanged.
  - The setting is stored, absent means off; the preview fails with the Ollama error when no base model is picked or Ollama can't be reached.
- **S27-T2** (UI; deps: S27-T1): the model builds section in Settings shows the preview and the override checkbox.
  - When all fit: "All <total> examples fit Ollama's <W>-token window." Otherwise: "The next build uses <fit> of <total> examples to fit Ollama's <W>-token window." With the override on and total > fit: "The next build uses all <total> examples, past Ollama's <W>-token window. Categorizing may stall unless Ollama's context is larger."
  - Checkbox "Use every example, even past Ollama's window", hint "For Ollama set up with a larger context and enough VRAM."; toggling saves and updates the preview.
  - Preview error: "Couldn't check Ollama's context window" with Try again.
  - Tests for each message, the checkbox saving, and the error retry; snapshots of the fit, trimmed and override states.

### Tooling and workflow

### S23: CI cache keyed on the compiler (#120, low)
- **S23-T1** (devops; deps: none): the CI cargo cache key includes the `rustc` version, so a new Rust release starts a fresh cache. CI passes on the PR.

### S24: check.sh task mode doesn't fail on dependency changes (#94, low)
- **S24-T1** (devops; deps: none): in `task` mode a dependency change prints `POLICY NOTE: dependency change <file> (gated in integration)` and does not fail; `fast` and `integration` still fail on it without the approval override. `check.test.sh` covers both.

### S25: write-prd settles conventions first (#69, low)
- **S25-T1** (workflow; deps: none; owner `prompt-engineer`): `write-prd` step 2's first round settles cross-cutting conventions `CLAUDE.md` doesn't already fix (spelling, naming of new terms) and records lasting ones in `CLAUDE.md`.

### S26: Release 7.2.0
As a user, I want V7.2 shipped as release 7.2.0, so that the fixes reach the installed app.
- **S26-T1** (backend; deps: none): the app version is 7.2.0 in both version files, and `CHANGELOG.md` has a `## 7.2.0` section with user-facing bullets (clearer Ollama messages and retries, builds that fit Ollama's context window (with an override), themed progress bars and note field, screen-reader link hints, plus neutral "general hardening and test fixes").
  - The release gate passes for tag `v7.2.0`.

## Decisions

- Scope: every open low-severity `factory-bug` issue (26).
- "No new bugs": council findings in V7.2 are fixed in this version, not filed as new issues.
- #87: shadcn Progress uses the installed `radix-ui` package; no new dependency.
- #104 and #117: one JSON-error conversion, mapped to the database kind.
- #94: task mode notes dependency changes; integration still gates them.
- Hardening fixes are tracked privately and named neutrally in everything committed.
- S27 (added after the PR opened, at the user's request): window from `num_ctx` else 4096; trim evenly across categories; 5 examples of headroom; override checkbox.
- Release: tag `v7.2.0` after merge.

## New Terms

None.

## Out of Scope

- New features; V8 (Dashboard).
