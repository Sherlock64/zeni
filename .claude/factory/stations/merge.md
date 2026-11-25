# Merge

**Outcome:** the PR is on `main` and its ticket is closed.

**Done when:** the PR is merged with green CI, the ticket is closed by its `Closes #<n>` and carries `state:merged`, and an epic whose tickets are all closed is closed too.

## Merge rules

All must pass, at every trust level. Check them in order and stop at the first that fails:

1. The latest Review comment is a pass (`Review PASS on <sha>.`) with no open blocker.
2. The PR's latest commit (`gh pr view <n> --json headRefOid`) is the one Review passed.
3. CI is green on that commit, including the door-label check.
4. The branch is up to date with `main`.
5. Exactly one `door:` label.
6. Not `door:one-way`: a one-way door always needs the user's yes.
7. No `open` `runtime` criterion in the verifier's latest PR comment: an open one needs the user's yes, as rule 6 does.

A failed rule, at any level: set `state:needs-human` and comment, first line `Merge rule <k> failed: <what you saw>.`, then the fix (a rebase, a new Review, the label). Rules 6 and 7 are not failures to fix: comment the merge ask below instead, naming the one-way door or each open criterion.

For rule 4, the dispatcher sends the ticket to Build to rebase (`state:building`); the new head goes through Build's checks and Review again, and rule 2 catches a stale pass.

## Asking or merging

Read Merge's level from the "Now" column of the trust-dial table in `spine.md`, never from memory.

- **Level 0 or 1**, a one-way door or an open runtime criterion: set `state:needs-human` and comment, first line `Merge PR #<n>? Review passed on <sha>, CI green.` (adding `Open runtime: <criteria>.` for rule 7) The ticket shows in the board's Needs you. End the run.
- **Level 2 or higher**, every rule passed: merge (below) without asking, and the run comment lists the seven rules checked.
- **The yes**: a fresh Merge run reads it only from a ticket comment after the merge ask (the dispatcher quotes a yes given in chat there). A yes in any other place doesn't count. Before merging, check the rules again: the PR's latest commit must still be the `<sha>` the ask names, or rule 2 fails. The yes also meets rules 6 and 7.

## Merging

- `gh pr merge <n> --merge`. Keep the merge commit; release notes and the board read PR numbers from it.
- Delete the branch, then archive each finished run session of the ticket (`list_sessions` with `linked: true`, then `archive_session`), so the app has no old folders to hand out. Archiving removes a clean worktree. It keeps one with uncommitted changes: list `git worktree list` paths under `.claude/worktrees/t<n>-*`, and for each left, name it and its `git status --short` in your run comment for the user to remove; never `--force`.
- List other open PRs that now conflict with `main` in your run comment; the dispatcher sends them back to their builders.

## Eject when

- CI fails on `main` after the merge.

## Pointers

Next: a merge with a door other than `door:docs` starts `stations/release.md` in the same dispatch.
