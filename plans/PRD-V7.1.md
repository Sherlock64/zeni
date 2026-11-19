# Personal Finance App — V7.1 PRD: Medium Bug Cleanup

V7.1 closes the 13 open medium `factory-bug` issues filed after V6.1 and V7: screen-reader announcements and a retry on the update and release-notes UI, Transactions tooltip details below `lg`, startup and update test gaps, three backend cleanups, one Review page style fix and one `build-version` workflow gap. It also carries some hardening fixes reviewed privately, and ships as release 7.1.0. It adds no feature and changes no data. Builds on PRD-V1.md to PRD-V7.md; see ROADMAP.md.

## User Stories

### S1: A new update is announced (#107, medium)
As a screen-reader user, I want to hear when "Zeni X is available" appears, so that I learn about an update without finding the banner.

- **S1-T1** (UI; deps: none): the update banner has an always-mounted polite status region.
  - While no update is known the region is empty and no banner shows.
  - When `update_status` resolves with a newer version, the region reads "Zeni <version> is available" and the visible banner shows.
  - A test asserts the region exists before the status resolves and holds the text after.

### S2: Release notes loading is announced (#108, medium)
As a screen-reader user, I want the Release notes dialog to say it is loading, so that I don't hear an empty dialog.

- **S2-T1** (UI; deps: none): while the notes load, the dialog has a status reading "Loading release notes…"; it clears once they show.
  - A test with pending notes finds the status text; after they resolve it is gone.

### S3: Update status error can be retried (#115, medium)
As a user, I want a failed update status in Settings > About to offer Try again, so that I can recover without restarting.

- **S3-T1** (UI; deps: none): the update section's error alert has a next step and an outline "Try again" button, as the app-info error does.
  - Pressing it refetches the update status; while refetching, further presses do nothing.
  - A test fails the load, presses Try again once, and sees the status after a successful retry; a second press during the retry fetches only once.

### S4: Update section loading is tested (#114, medium)
As a developer, I want the About card's update section loading state tested, so that a regression shows.

- **S4-T1** (UI; deps: S3-T1): an About card test with `update_status` never resolving.
  - The "Last check" list is `aria-busy="true"`; the switch is `aria-disabled="true"` and unchecked.
  - Pressing the switch does not call the set-update-checks command.

### S5: Category, balance and type readable below lg (#101, #103, medium)
As a user on a narrow window, I want the description tooltip to show the full category, balance and type, so that nothing hidden or truncated is lost.

- **S5-T1** (UI; deps: none): the Transactions description tooltip adds lines `Category: <name>`, `Balance: <amount>` and `Type: <type>`, each only when the row has it.
  - Balance uses the app's money format.
  - A test hovers or focuses a description and finds each line; a row without balance, type or category shows none of those lines.
  - Wider windows look as before. A snapshot at 800px shows the tooltip (`RUNTIME` for hover look).

### S6: Review select trigger matches the dark theme (#100, medium)
As a developer, I want the Review page's lightweight select trigger to carry only classes that apply, so that its look matches the real select without dead variants.

- **S6-T1** (UI; deps: none): the trigger keeps the native button (mounting hundreds of real Selects is too slow) and drops the `dark:` variants; it looks the same as the real select trigger in the app.
  - Review page tests pass; a snapshot shows no visual change.

### S7: Startup unwritable-folder test can fail (#113, medium)
As a developer, I want the unwritable backup folder test to fail if startup migrates anyway, so that it guards the block.

- **S7-T1** (backend; deps: none): the test first probes that the folder is really unwritable; if so it asserts startup returns the backup-failed block, with no conditional pass; if the probe can write (for example as root) it returns early with a comment.

### S8: Update tests don't depend on the clock (#112, medium)
As a developer, I want the once-a-day update tests to pass at any time, so that a run across midnight doesn't fail.

- **S8-T1** (backend; deps: none): the launch and check logic takes today's date as an argument, read once by the public entry points; the tests use fixed dates.
  - Two launches on the same fixed date check once; a launch on the next fixed date checks again.
  - Dismiss hides the banner until a launch check on a later fixed date.

### S9: Update tests clean up (#111, medium)
As a developer, I want the update tests to remove their temp databases, so that the temp dir doesn't fill up.

- **S9-T1** (backend; deps: S8-T1): the update test fixture removes its temp dir when dropped, like the startup tests' fixture; every update test uses it.
  - After the update tests run, no `zeni-test-<pid>-updates-*` dir remains.

### S10: One shared app_meta helper (#110, medium)
As a developer, I want one `app_meta` read and write helper, so that the copies don't drift.

- **S10-T1** (backend; deps: S8-T1): one read and one write helper for `app_meta`; backup, Ollama, updates, startup and release notes use them, and the copies and inline reads are gone.
  - All existing tests pass.

### S11: Startup logic lives in the startup module (#109, medium)
As a developer, I want continue-startup logic in the startup module, so that commands stay thin wrappers.

- **S11-T1** (backend; deps: S10-T1): the continue-startup logic and one shared mapping from a startup problem to the database and blocked status move to the startup module; the app's launch and the continue-startup command both use the mapping.
  - Continue startup returns the same results as before; existing startup tests pass and one covers the shared mapping for each problem kind.

### S12: Weekly usage pause doesn't ping (#123, medium)
As the user, I want the usage gate to warm the cache only on a 5-hour pause, so that a weekly pause doesn't cost about 100 pings.

- **S12-T1** (workflow; deps: none; owner `prompt-engineer`): the `build-version` usage gate starts the 55-minute cache-warm timer only when the 5-hour window is over the gate. On a weekly pause it starts no timer: it notifies the user with the reset time and stops.

### S13: Release 7.1.0
As a user, I want V7.1 shipped as release 7.1.0, so that the fixes reach the installed app.

- **S13-T1** (backend; deps: none): the app version is 7.1.0 in both version files, and `CHANGELOG.md` has a `## 7.1.0` section with user-facing bullets (announcements, Try again, tooltip details, plus neutral "general hardening and test fixes").
  - The release gate passes for tag `v7.1.0`.

## Decisions

- #100: keep the native trigger (performance) and drop the `dark:` variants, not use `SelectTrigger`.
- #101 and #103: one story, both through the description tooltip.
- #123: weekly pause stops and notifies; no single long timer.
- Hardening fixes are tracked privately and named neutrally in everything committed.
- Release: tag `v7.1.0` after merge.

## New Terms

None.

## Out of Scope

- Low-severity `factory-bug` issues (24 open).
