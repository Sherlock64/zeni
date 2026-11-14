# Personal Finance App — V5 PRD: Nicknames

V5 lets the user give transactions readable nicknames through match rules that apply to all past and future transactions. Builds on PRD-V1.md to PRD-V4.md; see ROADMAP.md.

## Requirements

- **V5-R1:** Nicknames table: ID, name (unique, case-insensitive), enabled, stale-exempt, created date. Nickname rules table: ID, nickname ID, mode (`exact`, `contains`, `regex`), field (`description` or `memo`), pattern, created date. A nickname has one or more rules.
- **V5-R2:** Match modes: exact is a case-insensitive whole-text match after trimming; contains is a case-insensitive substring; regex is a Rust regex (`regex` crate, approved dependency), validated on save, case-insensitive by default.
- **V5-R3:** Precedence: exact beats contains beats regex. Within a mode the longest pattern wins, then the oldest rule. Rules of disabled nicknames are ignored.
- **V5-R4:** Matching runs in Rust and writes a derived table (raw transaction ID → winning rule ID, both `ON DELETE CASCADE`), rebuilt when a rule or nickname changes and filled for new rows on import or revert. Raw rows are never changed.
- **V5-R5:** Transaction list: the nickname replaces the description; a tooltip shows the raw description and memo. Unmapped rows show raw text. Search matches nickname, description and memo.
- **V5-R6:** Right-click a transaction → "Rename it" → "What's its nickname?" dialog, prefilled with an exact rule on that row's description. An expander switches mode, field and pattern. A live count shows how many transactions the rule matches, before precedence. Typing an existing nickname's name adds the rule to it.
- **V5-R7:** Per rule and per nickname: match count and last matched date (newest matching posted date), derived from the lookup table (rows where that rule won).
- **V5-R8:** Stale flag: a nickname is stale when its last match is more than D days before the newest transaction in the database (D set in Settings, default 90), or it has never matched. Stale-exempt nicknames are never flagged. The flag is informational only.
- **V5-R9:** Nicknames management page in the sidebar: list with name, rules, match count, last matched, stale badge, on/off switch and stale-exempt option; add, edit and delete nicknames and rules; filter to stale.

## Out of Scope

- Default category per nickname (V6) and default budget item (V11).
- Glob patterns, manual rule ordering, bulk import of rules.
- Automatic deletion of stale nicknames.

## Edge Cases

- **Invalid regex:** rejected on save with the error position; nothing is stored.
- **Slow regex:** the `regex` crate runs in linear time; patterns are capped at 500 characters.
- **Rule that matches nothing:** allowed; the live count shows 0 and the nickname shows as never matched.
- **Reverting an import:** its rows leave the lookup table, so counts and last-matched dates drop.
- **Deleting a nickname:** its rules and lookup rows are deleted; transactions show raw text again.

## Acceptance Criteria

1. Renaming a transaction applies the nickname to every past matching transaction and to matching rows in later imports.
2. Exact, contains and regex rules each match as specified, on description and on memo.
3. When rules of several modes match, the precedence and tie-break in V5-R3 hold (covered by tests).
4. Turning a nickname off shows raw text again; turning it on restores it.
5. Match counts, last matched dates and stale flags are correct, and stale-exempt nicknames are never flagged.
6. Search finds transactions by nickname.
7. Raw transaction rows are unchanged by every nickname operation.
