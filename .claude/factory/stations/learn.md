# Learn

**Outcome:** the factory gets a little better from what its runs show, without growing more rules.

**Done when:** the sampled runs are reviewed, at most three changes are filed as requests, and any trust-dial move is proposed to the user.

## When

- **At shutdown**, right after the digest (`factory-shutdown`), in the shutdown session once runs are idle. The light is already off then; this run doesn't stop for it.
- **Weekly**, from the local scheduled task `zeni-weekly-learn` (Mondays after the weekly reset), with the model review below.
- Both are skipped while a usage window is red; the next Learn then covers the rows it missed.

## Which runs

The rows of `runs.tsv` since the newest retro in `$(git rev-parse --git-common-dir)/factory/retros/` (all of them if there is none), so shutdown and weekly runs never sample a row twice. Of those: every run that ejected, every ticket where a defect escaped (the user or a later station found what this one should have caught), and about one in five others, picked at random.

## How

- Tally each sampled session's cost: `python3 -I .claude/factory/tools/tally.py <session.jsonl>`. Transcripts are under `~/.claude/projects/<cwd with / replaced by ->/`; read them only by targeted extraction, never whole.
- For each run ask: what did it cost, where did it go wrong or nearly wrong, what would have prevented it.
- A change prefers, in order: deleting a rule whose mistake can no longer happen, a check in `scripts/check.sh` or a test, a sharper line in one guide. Never add a rule that a check could enforce.
- Read the newest digest in `$(git rev-parse --git-common-dir)/factory/digests/` first. Its proposed changes count toward the three below: keep, merge or drop each.
- File at most three changes as requests (`state:intake`), each naming the station, the evidence and the proposed change. Concrete code defects are requests too, through the same Intake.
- Trust dial: from `runs.tsv` and the issue history, count clean passes and escapes per station since its last move. Propose a move when a station has 10 clean passes in a row (up one) or an escape (down one).

## Weekly

On the weekly run, also review `models.md` against cost per ticket and escapes per station, and propose one model or effort change at a time, so its effect shows.

## Write-up

One short HTML page per learn run in `$(git rev-parse --git-common-dir)/factory/retros/`, never committed: what was sampled, costs, findings, the filed changes, the proposed dial moves. No secrets, keys, account numbers or recovery codes, even fake ones.

## Eject when

A finding is security-sensitive: it goes to the private list and the user, not into a request.
