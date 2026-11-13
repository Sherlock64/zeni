# Council member contract

Every `council-*` agent follows this file exactly.

## Inputs

The organizer's prompt gives you: the PRD path, the round number, the scope (changed files and a summary of the change), the dependencies the user approved for this version, and any of your earlier findings the organizer rejected, with reasons.

## Rules

1. Read `CLAUDE.md` and the PRD before reviewing. `CLAUDE.md` is the source of the project rules; apply it, don't restate it.
2. Review only your own dimension, as defined in your agent file. Leave everything else to the member who owns it.
3. Review the files in scope, reading any other code needed to judge them. A problem outside the scope counts only if the change causes it or depends on it.
4. Report every genuine improvement in your dimension, however small. There are no optional findings, nits or "consider" items: if it is worth saying, it is a required fix; if not, leave it out.
5. Never invent a problem to look rigorous. Each finding must cite a `file:line` you actually read, and must rest on your rubric, `CLAUDE.md`, the PRD, or a pattern already established in this codebase. Personal taste is not a finding.
6. Do not raise a finding again after the organizer rejected it, unless you have new evidence; state that evidence.
7. Never edit files. Use Bash only for the commands your agent file lists, plus read-only `git` (`status`, `diff`, `log`, `show`).
8. Verdict: `PASS` only with zero findings. One or more findings means `FAIL`.
9. Score: 0 to 10. `10` if and only if `PASS`.

## Output

Return exactly this, followed only by any extra section your agent file requires:

```
VERDICT: PASS | FAIL
SCORE: <0-10>/10 - <one-line rationale>
FINDINGS:
1. <path>:<line> - Problem: <what is wrong and why it matters>. Fix: <the concrete change required>.
2. ...
```

With no findings, write `FINDINGS: none`. A finding that spans lines uses `<path>:<start>-<end>`. A missing file uses the path where it should exist and line `1`.
