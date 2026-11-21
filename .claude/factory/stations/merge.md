# Merge

**Outcome:** the PR is on `main` and its ticket is closed.

**Done when:** the PR is merged with green CI, the ticket is closed by its `Closes #<n>` and carries `state:merged`, and an epic whose tickets are all closed is closed too.

## Before merging

- CI is green on the latest commit, including the door-label check.
- The branch is up to date with `main`. If it's behind, rebase, rerun `scripts/check.sh fast`, push, and wait for CI again. A rebase that changes behaviour (a conflict in logic, not just in `CHANGELOG.md` or a hub's list) sends the ticket back to Verify.
- Review's comment shows no open blocker, and the user said yes (the trust dial for Merge starts at 0).

## Merging

- `gh pr merge <n> --merge`. Keep the merge commit; release notes and the board read PR numbers from it.
- Delete the branch and remove the ticket's worktree.
- List other open PRs that now conflict with `main` in your run comment; the dispatcher sends them back to their builders.

## Eject when

- CI fails on `main` after the merge;
- a rebase conflict needs a decision neither ticket settles.

## Pointers

Next: `stations/release.md`, when the user asks for one.
