---
name: fix-bug
description: Playbook for fixing one Zeni bug or making one small fix as a hotfix, from reproduction through a failing regression test, the smallest fix, checks and a risk-selected council to a PR. Use when the user reports a bug, a wrong behaviour or an error, gives a `factory-bug` issue (`#<n>` or its URL) or a private security bug (`SB-<n>`), or asks for a small fix that needs no PRD.
---

# Fix bug

1. **Branch.** Run `git status`; if the tree isn't clean, ask the user. `git fetch origin`, then `git switch -c v<version>-<one or two words> origin/main`, taking the next hotfix number per the branch rule in `CLAUDE.md`; for `SB-<n>`, neutral words (`build-version` step 6.2). Evidence goes in `snapshots/V<version>/`.
2. **Reproduce.** Given `#<n>` or an issue URL, `gh issue view <n>` is the bug report; if it is security-sensitive after all (`build-version` step 6.2), stop and ask. Given `SB-<n>`, its entry in `snapshots/security-bugs.md` is the report. From here on, every test name, comment and doc you or a delegated dev write follows the `build-version` step 6.2 neutral-wording rule; say so in each delegated task. Find the exact input and code path that fail, citing `file:line`. If it won't reproduce, or the fix needs a decision the report doesn't settle, ask the user. A novel or high-risk decision gets the `build-version` Design check.
3. **Regression test.** Write the test that fails for this bug at a public seam (dev-contract rule 5) and run it to see it fail.
4. **Smallest fix.** Fix the root cause once, in the shared code; grep every caller of what you change. Do it yourself under `CLAUDE.md` and `.claude/skills/build-version/dev-contract.md` rules 1-6, or, when the fix spans owners or is more than a small change, delegate each file set to its owner as `build-version` step 2.2 does. UI changes take the snapshots in `.claude/agents/ui-dev.md`.
5. **Task check.** `scripts/check.sh task` with the `--rust`/`--ts` filters for the changed code (dev-contract rule 9).
6. **Integration.** `build-version` step 3, with `snapshots/V<version>/evidence.yaml`.
7. **Council.** Run the `council-review` skill with the bug report and fix as the task brief; it selects members by risk. Fix blocking findings as `build-version` step 5 does.
8. **PR.** `build-version` step 6.2: commit once as `v<version>: <summary>`, push, `gh pr create --base main`, publishing findings only as that step allows. For an issue, the commit message and PR body include `Closes #<n>`. For `SB-<n>`, follow the neutral-wording rule and PR body carve-out in step 6.2, then set its entry to `Status: fixed (<branch>)`. Then tell the user the PR link and how to check the fix. Don't merge.
