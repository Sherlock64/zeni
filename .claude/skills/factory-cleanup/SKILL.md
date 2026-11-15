---
name: factory-cleanup
description: Bundle every open factory-bug GitHub issue into one Zeni minor version, from a PRD with one requirement per issue through build-version to a PR that closes them. Use when the user says "factory-cleanup", "/factory-cleanup", "clean up factory bugs", or asks to fix all open factory-bug issues at once.
---

# Factory cleanup

1. **Collect.** `gh issue list --label factory-bug --state open`, then `gh issue view <n>` for each. Take only public `factory-bug` issues; never add others or `SB-<n>` entries, since the PRD is committed. If an issue looks security-sensitive after all (`build-version` step 6.2), leave it out and ask the user. Group the rest by area.
2. **PRD.** Write `plans/PRD-V<x.y>.md` for the next minor version (`CLAUDE.md` branch rule) in the `write-prd` house format (its section 3), one requirement per issue citing `#<n>`. Skip the interview unless an issue leaves a decision open.
3. **Checkpoint.** Ask the user to confirm the version and the PRD. Stop until they do.
4. **Build.** Run the `build-version` skill on the PRD. The PR body adds `Closes #<n>` for each issue.
