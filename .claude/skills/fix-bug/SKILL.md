---
name: fix-bug
description: Playbook for fixing one Zeni bug or making one small fix as a hotfix, from reproduction through a failing regression test, the smallest fix, checks and a risk-selected council to a PR. Use when the user reports a bug, a wrong behaviour or an error, or asks for a small fix that needs no PRD.
---

# Fix bug

1. **Branch.** Run `git status`; if the tree isn't clean, ask the user. `git fetch origin`, then `git switch -c v<version>-<one or two words> origin/main`, taking the next hotfix number per the branch rule in `CLAUDE.md`. Evidence goes in `snapshots/V<version>/`.
2. **Reproduce.** Find the exact input and code path that fail, citing `file:line`. If it won't reproduce, or the fix needs a decision the report doesn't settle, ask the user. A novel or high-risk decision gets the `build-version` Design check.
3. **Regression test.** Write the test that fails for this bug at a public seam (dev-contract rule 5) and run it to see it fail.
4. **Smallest fix.** Fix the root cause once, in the shared code; grep every caller of what you change. Do it yourself under `CLAUDE.md` and `.claude/skills/build-version/dev-contract.md` rules 1-6, or, when the fix spans owners or is more than a small change, delegate each file set to its owner as `build-version` step 2.2 does. UI changes take the snapshots in `.claude/agents/ui-dev.md`.
5. **Task check.** `scripts/check.sh task` with the `--rust`/`--ts` filters for the changed code (dev-contract rule 9).
6. **Integration.** `build-version` step 3, with `snapshots/V<version>/evidence.yaml`.
7. **Council.** Run the `council-review` skill with the bug report and fix as the task brief; it selects members by risk. Fix blocking findings as `build-version` step 5 does.
8. **PR.** `build-version` step 6.2: commit once as `v<version>: <summary>`, push, `gh pr create --base main`, never council findings in GitHub text. Then tell the user the PR link and how to check the fix. Don't merge.
