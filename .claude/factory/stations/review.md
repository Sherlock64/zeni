# Review

**Outcome:** a verdict on the PR from a small panel picked by risk, where only proven problems block.

**Done when:** no proven blocker is left, each non-blocking finding is fixed in this PR, sent to Intake, or listed as a nit, CI is green on the PR's latest commit, the PR is out of draft, and one review comment on the PR holds the result and names the reviewed commit. The ticket stays `state:reviewing` for Merge (`stations/merge.md`), which asks the user or merges.

## The panel

Spawn the seats in one message, each with the PR, the ticket and the verifier's comment (or the PR body's line saying it was skipped):

| Seat | Agent | When |
|---|---|---|
| Spec | `review-spec` | every PR |
| Standards | `review-standards` | every PR except `door:docs` |
| Security | `review-security` | a sensitive path (listed in the agent), a new or changed command, file format or permission, or how data is stored, imported, exported or deleted |
| Experience | `review-experience` | any UI under `src/` |
| Pipeline | `review-pipeline` | `.github/workflows/`, `scripts/check.sh`, `scripts/release-check*`, `src-tauri/deb/`, the `bundle` section of `tauri.conf.json` |

Add a seat when you can't bound the change's reach; never drop Spec. Spawn each with the model in `models.md`.

Each seat replies in this shape and nothing else:

```
<seat> PASS|BLOCK
BLOCK: <path>:<line> - <problem> - proof: <failing command, rule, or user steps> - fix: <change>
FIX-HERE: <path>:<line> - <problem> - fix: <change>      (cheaper to fix than to file)
INTAKE: <path>:<line> - <problem>                         (real, but not this PR)
NIT: <path>:<line> - <note>
```

A seat with no proof writes no `BLOCK`. Every line cites a `file:line` it read. Security writes its findings to the private list instead and replies only its verdict and counts.

## Deciding

- A finding blocks only with proof: a failing run or test, a broken `CLAUDE.md` rule, or a bug a user would hit, with the steps. Check each blocker in the code yourself before you accept it.
- Also check: the `door:` label fits its one-line reason, the `CHANGELOG.md` bullet says what changed for a user, and the diff stays inside the ticket's modules plus the hubs (`stations/build.md`).
- Small non-blocking fixes that cost less than filing them go back to the builder with the blockers. The rest become requests (`state:intake`). Nits are listed in the comment and never filed.
- Blockers or fixes in this PR: set `state:building` with the list. The next review re-runs only the seats that had findings, plus Spec.

## Passing

A pass needs green CI on the commit you reviewed:

1. Note the PR's latest commit: `gh pr view <n> --json headRefOid`.
2. Wait for CI on it: `gh pr checks <n> --watch` (in the background).
3. Red: set `state:building` with the failing check. Green: `gh pr ready <n>`, then post the review comment, its first line `Review PASS on <sha>.` with the full commit. A commit pushed while you reviewed means you reviewed the wrong one: review again.

## Privacy

The repo is public. Security findings never go in the PR comment; they go to the private list, and the comment says "security: reviewed". Blockers are described by behaviour, not by how to exploit them.

## Eject when

- the same blocker survives two rounds;
- two seats contradict each other and the ticket doesn't settle it.

## Pointers

Seats: `.claude/agents/review-*.md`. Next: `stations/merge.md`.
