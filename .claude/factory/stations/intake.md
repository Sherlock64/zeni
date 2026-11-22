# Intake

**Outcome:** every raw request is sorted: bug or feature, size, public or private, new or duplicate.

**Done when:** each request has a next state with a one-line reason in a comment, or is closed with one, and one `runs.tsv` row per request is appended (`spine.md`, Run log), also when Intake runs inside `/factory`. Intake only sets the next state; it never starts the Shape or Build session (the dispatcher does). Next states:

| Request | Next |
|---|---|
| a bug or small change, clear enough to state acceptance criteria now | `state:ready`, as a standalone ticket |
| a feature, or a change with an open decision | `state:shaping` (a new epic, or added to an existing one's body) |
| part of an open epic's scope | a ticket under that epic, or `state:shaping` if its criteria aren't settled |
| a duplicate or already done | closed, with a link to the original or the PR |
| not worth doing | closed as `wontfix`, with the reason |
| security-sensitive | moved to the private list (`spine.md`), and the public issue closed with neutral wording, or never created |

## Sorting

- Labels: `bug` or `enhancement` (both exist), and `severity:low|medium|high|critical` on bugs, by worst realistic consequence: data loss or an exposed secret is `critical`; a broken rule or a flow that misleads is `high`; a defect a user meets is `medium`; polish is `low`.
- A standalone ticket gets the ticket shape from `stations/shape-slice.md`: behaviour, acceptance criteria, modules, "blocked by". Read the code it names before you write criteria; a criterion you can't check against the code is an open decision, so the ticket goes to shaping.
- Merge near-duplicates into the clearest issue and close the rest with a link. Prefer one issue per defect.
- Read old `factory-bug` issues as requests like any other. Many lows are not worth a run; closing them with a reason is a fine outcome.
- When unsure whether something is security-sensitive, treat it as private.

## Trust

At level 1 you propose: write the sorting as one table in your run comment (issue, labels, next state, reason) and change nothing until the user says yes. From level 2 you apply it.

## Eject when

- a request is security-sensitive and already public in detail;
- sorting it needs a product decision (whether the app should do this at all).

## Pointers

Labels and states: `spine.md`. Product preferences: `plans/ROADMAP.md`. Next: `stations/shape-slice.md` or `stations/build.md`.
