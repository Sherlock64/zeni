# Personal Finance App — V6.1 PRD: Medium Bug Cleanup

V6.1 closes the 13 open medium `factory-bug` issues filed after V6: Review page and Categories tests, keyboard focus and announcements on the Ollama card and Categories page, Transactions column wrapping, two small code cleanups and one `write-prd` workflow gap. It adds no feature and changes no data. Builds on PRD-V1.md to PRD-V6.md; see ROADMAP.md.

## User Stories

### S1: Review loading status clears (#82, medium)
As a screen-reader user, I want "Loading the review…" to clear once the review is drawn and not come back on a refetch, so that I'm not told it is still loading.

- **S1-T1** (UI; deps: none): a Review page test covers the loading status.
  - After the last group draws, the page status is empty.
  - A refetch that returns more groups leaves the status empty.

### S2: Categories Try again on Review is tested (#81, medium)
As a user, I want Try again for the Review page's categories to behave like the groups Try again, so that a failed load can be retried safely.

- **S2-T1** (UI; deps: none): Review page tests for the categories Try again, mirroring the groups retry tests.
  - A repeat failure shows the error again with Try again.
  - While retrying, the button reads its busy label and has `aria-disabled="true"`.
  - A second press while retrying fetches only once.

### S3: "Looks good (all N)" covers hidden rows (#80, medium)
As a user, I want "Looks good (all N)" to mark every row in the group, including the ones not shown yet, so that nothing is left unreviewed.

- **S3-T1** (UI; deps: none): a Review page test clicks "Looks good (all N)" before Show more.
  - The mark-reviewed command receives every id in the group, hidden rows included.

### S4: Check again is announced every time (#79, medium)
As a screen-reader user, I want Check again on the Ollama card to announce its result even when it matches the last one, so that I know the check ran.

- **S4-T1** (UI; deps: none): the Ollama card re-announces its status after every Check again.
  - Two Check again presses with the same result each announce the status in the polite live region.
  - A test asserts the second announcement.

### S5: Focus stays put when Check again fails (#78, medium)
As a keyboard user, I want focus kept when Check again turns the Ollama card from success to error, so that I don't lose my place.

- **S5-T1** (UI; deps: none): after Check again changes the card from success to error, focus moves to the new error alert's Check again (or Try again) control.
  - A test presses Check again on a success card, the status turns to an error, and the focused element is that control, not the page body.

### S6: Import commit with nothing pending is tested (#77, medium)
As a user, I want committing an import that is no longer pending to fail with a clear error, so that a stale dialog can't import twice.

- **S6-T1** (backend; deps: none): a test commits an import through the categorizing commit path with nothing pending.
  - It returns the same error the import commit returns when nothing is pending, and starts no categorize job.

### S7: Unmapped validation errors show on the category form (#76, medium)
As a user, I want a validation error that isn't about one field to still show on the category form, so that I know why saving failed.

- **S7-T1** (UI; deps: none): a category form test rejects the save with a Validation error that names no form field.
  - The form shows the error message in its alert, and stays open with the entered values.

### S8: Tests wait before asserting absence (#75, medium)
As a developer, I want tests that check something is absent to wait for the query to settle first, so that they can't pass for the wrong reason.

- **S8-T1** (UI; deps: none): the Categories page, categorize banner and app-shell tests wait for a settled element before every absence assertion.
  - Each absence assertion in those tests comes after a wait for an element that only shows once the data has loaded.
  - The tests still pass.

### S9: Focus stays on Categories after dismissing the reorder error (#74, medium)
As a keyboard user, I want focus to land on the category list when I dismiss the reorder error, so that I don't lose my place.

- **S9-T1** (UI; deps: none): dismissing the reorder error alert moves focus to the category list.
  - A test fails a reorder, dismisses the alert, and the focused element is the list (or its first item), not the page body.

### S10: Transactions rows stay one line at 800px (#73, medium)
As a user, I want Transactions rows to stay short at an 800px-wide window, so that the list is easy to scan.

- **S10-T1** (UI; deps: none): at 800px the Category and Description cells stay on one line.
  - The description truncates to one line with an ellipsis; its full text is in a tooltip shown on hover and on keyboard focus.
  - The category name truncates; its badge and dot stay on the same line.
  - Wider windows look as before.
  - An 800px snapshot shows one-line rows.

### S11: Review page types live in the types module (#72, medium)
As a developer, I want the Review page's mutation variable types in the UI types module, so that the types-in-type-modules rule holds.

- **S11-T1** (UI; deps: none): the Review page's mutation variable types move to the UI types module; the page behaves as before and its tests pass.

### S12: No panic in mark reviewed (#71, medium)
As a user, I want marking rows reviewed to never crash the app, so that a bad case returns an error instead.

- **S12-T1** (backend; deps: none): mark reviewed binds its ids without `expect`; a failure returns an `AppError`.
  - Existing mark-reviewed tests pass, and no `expect` or `unwrap` remains on that path.

### S13: write-prd recommends from my product preferences (#68, medium)
As the user, I want write-prd's recommendations to follow my product preferences, so that I don't have to override minimal picks every interview.

- **S13-T1** (workflow; deps: none; owner `prompt-engineer`): a "Product preferences" section in `plans/ROADMAP.md`, and `write-prd` reads it in step 1 and bases its product recommendations on it.
  - The section lists: richer UX is preferred over minimal UI; a mature dependency is fine when it buys real UX; American spelling.
  - `write-prd` says to add a preference when an interview shows a new one.

## Decisions

- #96 (organizer token cost) is left out: PR #95 shipped its fix, and this session's retrospective measures it against the target; it closes or gets adjusted after that.
- #73: truncate with a tooltip, not min widths, so the table never scrolls sideways.
- #78: focus moves to the control in the new error alert, since Check again unmounts.
- #74: focus moves to the category list, where the user was working.

## New Terms

None.

## Out of Scope

- Low-severity `factory-bug` issues.
- #96.
