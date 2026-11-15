---
name: retrospective
description: Review a finished Claude Code session on Zeni and write a local, uncommitted HTML retrospective in retros/ covering what went well, what could have gone better, and how to spend fewer tokens next time, then file its concrete defects as factory-bug issues (with the user's yes) or in the private security bug list. Use when the user says "retro", "retrospective", "/retrospective", or asks what we could have done better in this session.
---

# Retrospective

Review one session (default: the current one) and write `retros/<YYYY-MM-DD>-<branch>.html`. `retros/` is gitignored: never stage, commit or publish the page. Its findings reach GitHub only as `factory-bug` issues (step 4), under the publication rule in `build-version` step 6.2.

## 1. Gather

1. Find the transcript: `~/.claude/projects/<cwd with every "/" replaced by "-">/<session-id>.jsonl`. For the current session, take the most recently modified `.jsonl` there. Its subagents are in `<session-id>/subagents/`.
2. Run `python3 -I .claude/skills/retrospective/tally.py <transcript>` and save the JSON to your scratchpad. It gives, for the main session and each subagent (type and task description): API requests, uncached input, cache writes, cache reads, output, a `weighted` cost estimate (cache write 2x, cache read 0.1x, output 5x, relative to uncached input), tool-call counts, the user's prompts, and start and end times.
3. Read only what you need. The transcripts are megabytes, so never read them whole. Use the tally's `user_prompts` and targeted `grep`/`python3 -I` extraction for: the user's corrections and redirections, agent reports with `BLOCKED` or `NEEDS`, failed checks, council verdicts per round, re-run or re-spawned tasks, and questions asked of the user.
4. Add context from `git log`/`git diff --stat` for the session's branch and, if there was a version build, the PRD and `snapshots/V<n>/council-findings.md`.

## 2. Analyse

Every point cites evidence (a prompt, a report, a number from the tally) and ends with one concrete change: an edit to a named skill, agent, `CLAUDE.md` rule or habit.

- **What went well:** decisions and patterns worth keeping.
- **What could have gone better:** user corrections (each one is a missed expectation), rework and why it happened, council blocking findings that earlier guidance could have prevented, waits and stalls, questions that could have been avoided or should have been asked sooner.
- **Token savings:** rank agents by `weighted` cost and explain the top consumers. Look for agents that re-read the same large files, long chains of small tool calls, duplicated prompts across agents (for example eight council members each re-deriving the same scope), image-heavy snapshot reviews, full-council re-runs that only needed a few members, work done twice, and context that grew without need. Estimate each saving from the tally numbers and say what it would cost in quality.

## 3. Write the page

One self-contained HTML file. No external scripts, fonts or images: it is opened from disk.

- Dark theme, system fonts, readable at 800px wide.
- Header: session title, branch, date, duration and total weighted tokens.
- Sections in this order: Summary (three bullets), What went well, What could have gone better, Token savings, Recommended changes (a checklist, highest value first).
- Token section: a table of the main session and every subagent (type, task, requests, output, cache reads, weighted), sorted by weighted cost, with an inline CSS bar per row. Below it, the user's 5-hour and weekly usage from `get_usage` if available.
- Plain language, short paragraphs. No secrets, passwords, keys, account numbers or recovery codes, even fake ones.

## 4. File factory-bugs

1. Collect candidates into one list: every non-blocking follow-up in `snapshots/V<n>/council-findings.md` for the session's version(s) not already marked `-> #<n>` or `-> SB-<n>`, plus the "could have gone better" items that are concrete defects. Mark the `build-version` step 6.2 floor items `private` yourself.
2. Spawn `council-security` once with the rest, each with an id, and the step 6.2 rule. Tell it this is triage mode: instead of the member-contract VERDICT/FINDINGS format, it replies one line per item, `<id> public|private - <reason>`, and says private when unsure.
3. Append each private item to `snapshots/security-bugs.md`, numbering on from its last entry: `SB-<n> [severity] <path>:<line> - Problem: ... Fix: ... Source: <version> <member|retro>. Status: open`. Mark its source line `-> SB-<n>`.
4. Dedupe the public ones by file and problem against `gh issue list --label factory-bug --state open --limit 1000`. One issue per defect.
5. Give each public item a severity: its finding's (non-blocking findings are normally `medium` or `low`), or for a retro item the one you assign. Show the user each issue's full rendered title, body and severity label, plus how many items went private (count only). Create nothing without their yes. Creating issues is outward-facing.
6. Create each missing label once (`gh label list`):
   - `gh label create factory-bug --color 5319E7 --description "Minor defect filed by Zeni's agent workflow"`
   - `gh label create severity:<level> --color <color> --description "<Level> severity"`, colors `critical` B60205, `high` D93F0B, `medium` FBCA04, `low` 0E8A16.

   Create each issue with `gh issue create --label factory-bug --label severity:<level>`, title `<area>: <short defect>`, body:
   ```
   **Problem:** <one or two sentences>
   **Where:** `<path>:<line>`
   **Fix:** <the suggested fix>
   **Source:** <version> council (<member>) | <version> retro
   ```
7. Mark each source line in `council-findings.md` with `-> #<n>`.

## 5. Report

Give the user the file path, the issues filed, the number of new `SB-<n>` entries, the three most valuable recommended changes, and offer to make them. Change no skill, agent or rule without the user's yes.
