# Personal Finance App — V5.1 PRD: Bug Cleanup

V5.1 closes the 36 open `factory-bug` issues filed after V4, v4.0.2 and V5: Backups and Unlock polish, Nicknames polish, accessibility announcements, small code cleanups and snapshot tooling. It adds no feature and changes no data. Builds on PRD-V1.md to PRD-V5.md; see ROADMAP.md.

## Requirements

### Unlock and undo restore
- **V5.1-R1 (#15, medium):** The Unlock page reads the undo-restore state from the security status query itself; `AppShell` no longer passes it as a prop.
- **V5.1-R2 (#22, low):** After Undo restore succeeds, the Unlock page shows and announces "Restore undone. Your previous data is back."
- **V5.1-R3 (#23, low):** In recovery mode, when an undo is available, the prompt adds "Use a recovery code that was valid when this backup was made."
- **V5.1-R4 (#25, low):** The Undo restore error's next step reads "Try again, or unlock and restore a safety copy from Settings. The backup folder keeps every safety copy."
- **V5.1-R5 (#24, low):** The Unlock test asserts the button's role, name and behaviour, not `data-variant`.

### Backups card (Settings)
- **V5.1-R6 (#16, medium):** Saving retention shows a visible confirmation next to Save, as the other Settings saves do.
- **V5.1-R7 (#17, medium):** The card's status message clears when the user starts another action in the card.
- **V5.1-R8 (#21, medium):** A backup settings load error offers Try again, which refetches the settings, like the backups list error.
- **V5.1-R9 (#18, low):** The restore dialog description names the picked file by file name; the full path is on a separate secondary line outside the description.
- **V5.1-R10 (#19, low):** Each restore button's accessible name includes the backup kind, e.g. "Restore the safety copy from <date>".
- **V5.1-R11 (#20, low):** `formatBackupDate` and `formatSize` move to `src/lib/` with their own tests.

### Nicknames page
- **V5.1-R12 (#41, low):** The stale filter's empty state offers an outline "Show all nicknames" button that turns the filter off.
- **V5.1-R13 (#45, low):** With Show only stale on, the page status text includes how many stale nicknames are shown.
- **V5.1-R14 (#46, low):** On a nickname's only rule, the disabled Delete rule reason is linked by `aria-describedby`, not part of the item's name.
- **V5.1-R15 (#47, low):** The menu trigger ref is guarded with `if`, not a non-null assertion.
- **V5.1-R16 (#50, low):** Per-rule last-matched date and count show only when a nickname has more than one rule.
- **V5.1-R17 (#34, medium):** The Add nickname dialog's "Adds this rule to X." is announced through an always-mounted polite live region, as in the rename dialog.

### Rename dialog and Transactions
- **V5.1-R18 (#33, medium):** Each Transactions row has `aria-describedby` pointing at one shared sr-only hint: "Press Shift+F10 or the menu key for actions."
- **V5.1-R19 (#44, low):** The row ContextMenu's `modal={false}` has a one-line comment giving its reason, or is removed if not needed.
- **V5.1-R20 (#51, low):** A nicknamed row shows a small decorative tag icon next to its name; raw bank-text rows don't.
- **V5.1-R21 (#40, low):** The Match options expander has no negative margin and sits left-aligned with the fields.
- **V5.1-R22 (#52, low):** When a row with a nickname stops being renamed, "currently shown as X" appears once (in the note), not also in the description.
- **V5.1-R23 (#53, low):** While the nickname list retries, Try again reads "Trying again…".
- **V5.1-R24 (#42, low):** All Nicknames copy says "the bank's text" (not "the bank's description" or "their bank text").

### Settings Nicknames card
- **V5.1-R25 (#32, medium):** A Nicknames card load error offers an outline Try again that refetches and ignores repeat clicks while fetching.
- **V5.1-R26 (#30, medium):** A test leaves `nicknameSettings` pending and asserts the stale-days field and the card's Save are absent.
- **V5.1-R27 (#43, low):** Tests assert stale days 1 and 3650 pass the client check and reach `setNicknameStaleDays`.

### Code cleanups
- **V5.1-R28 (#31, medium):** One `errorField` in `src/lib/`, with a comment naming the `nicknames.rs` messages it matches, imported by both callers.
- **V5.1-R29 (#38, low):** The `list_nicknames` and `list_transactions` query keys are constants in one module, used everywhere.
- **V5.1-R30 (#39, low):** The UI's nickname limits (500, 100, 1..=3650) live in one `src/lib/` constants file whose comment names the backend constants.
- **V5.1-R31 (#36, low):** `NicknameRuleFields` drops `showCount`; the rename dialog composes the fields and `RuleMatchCount` itself.
- **V5.1-R32 (#37, low):** `created_at` is dropped from the `Nickname` and `NicknameRule` IPC types and their SELECTs (the column stays); bindings regenerated.
- **V5.1-R33 (#48, low):** Type imports in `src/types/ui.ts` are alphabetical.
- **V5.1-R34 (#49, low):** `DropdownMenuSeparator` is removed from `src/components/ui/dropdown-menu.tsx`.

### Snapshot tooling (dev only)
- **V5.1-R35 (#26, low):** `?fail=` picks the error message per command, so `?fail=undo_restore:Backup` shows undo's own message.
- **V5.1-R36 (#35, medium):** Snapshot steps gain `?contextmenu=<row text>`; `?click=` also matches `aria-label` and `role=menuitem`; one fixture can be overridden, e.g. `?nicknames=empty`.

### Council follow-ups
- **V5.1-R38:** The file-dialog helper in `commands.rs` has a test for cancel, an unreadable pick and a picked path.
- **V5.1-R39:** The Transactions test proves the row hint is one shared element (two rows share the id; the text appears once).
- **V5.1-R40:** The "Adds this rule to X." hints in the rename and Add nickname dialogs use a gap, not a negative margin.
- **V5.1-R41:** A single-rule nickname has one actions menu, on the nickname row, holding its rule's actions too (Edit rule, and Delete rule disabled with its reason per R14).
- **V5.1-R42:** At 800 px the rule's mode · field label doesn't wrap mid-phrase.
- **V5.1-R43:** The Backups card names the pre-revert kind one way everywhere: "before-revert backup" (Kind column "Before revert").
- **V5.1-R44:** Every load-error Try again (Nicknames page, Settings Nicknames card, backup settings, backups list) reads "Trying again…" while it refetches, keeps focus on the button, and ignores repeat clicks.
- **V5.1-R45:** The Unlock undo success live region stays in the accessibility tree while empty.
- **V5.1-R46:** The snapshot mock gives `backup_settings` a realistic load-error message.
- **V5.1-R47:** `src/types/ui.ts` has no doubled blank line.

### Private hardening
- **V5.1-R37:** Fix all SB tasks.

## Out of Scope

New features, schema changes, and any change to imported data or backups on disk.

## Edge Cases

- R7: a message that was just shown stays until the next action in the card starts; leaving and reopening Settings also clears it.
- R16: a nickname going from two rules to one hides the per-rule figures at once.
- R32: removing `created_at` must not change any migration; the column keeps its default.

## Acceptance Criteria

1. Every requirement above has a UI or Rust test, except R19, R21, R33, R34, R40, R45 and R47 (checked by reading the code) and R35, R36, R42, R46 (checked by running `scripts/snapshot.sh`; `RUNTIME`).
2. R20 is checked in the running app (`RUNTIME`): nicknamed rows show the tag, raw rows don't.
3. `scripts/check.sh integration` passes and bindings are fresh.
4. The PR closes #15 to #26 and #30 to #53.
5. All SB tasks fixed.
