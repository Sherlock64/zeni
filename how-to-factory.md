# How to use the factory

Zeni is built by a "factory": a set of Claude Code skills, station guides and reviewer agents that turn ideas and bugs into reviewed pull requests, mostly in parallel and with you deciding only what needs a human. This page is for anyone who wants to run it, on Zeni or as a model for their own project.

The rules the agents follow live in [`.claude/factory/spine.md`](.claude/factory/spine.md) (read it once; it is short) and the station guides in [`.claude/factory/stations/`](.claude/factory/stations/). The diagrams are in [`docs/workflow.md`](docs/workflow.md).

## What you need

- **The Claude desktop app (Code tab).** The factory starts one session per ticket, each in its own git worktree, and the watchdog reads your usage limits. Both rely on tools the desktop app provides; the plain terminal CLI can't run the dispatcher.
- **Your own GitHub repository** (a fork works) with the [`gh` CLI](https://cli.github.com) signed in. Tickets, epics and pull requests are GitHub issues and PRs.
- **The project's labels** in that repository (see below).
- **The app's own prerequisites**, so runs can build and test it: see [README.md](README.md).

### Create the labels

Every ticket has one `state:` label and every PR one `door:` label. In a fork, create them once:

```bash
gh label create state:intake --color C5DEF5 --description "Raw request, waiting to be sorted"
gh label create state:shaping --color BFD4F2 --description "Decisions or tickets still being settled"
gh label create state:ready --color 0E8A16 --description "Unblocked and unclaimed: on the frontier"
gh label create state:building --color 1D76DB --description "Claimed; a run is building it"
gh label create state:verifying --color 5319E7 --description "A fresh verifier is driving the real app"
gh label create state:reviewing --color D4C5F9 --description "The review panel is on the PR"
gh label create state:merged --color 6F42C1 --description "On main, not yet released"
gh label create state:released --color 0B5D1E --description "Shipped in a release"
gh label create state:needs-human --color B60205 --description "Ejected: waiting on the user's answer"
gh label create door:one-way --color B60205 --description "Irreversible or a major UX shift: major release"
gh label create door:two-way --color FBCA04 --description "Can be backed out by another change: minor release"
gh label create door:none --color 0E8A16 --description "Small, low-weight: patch release"
gh label create door:docs --color CFD3D7 --description "Docs, plans or factory files only: never releases"
```

## The words you'll see

| Word | Meaning |
|---|---|
| Request | Anything raw: an idea, a bug, a review finding. An issue labelled `state:intake`. |
| Epic | One feature, named, not numbered ("Accounts and debts"). Its issue body is the spec. |
| Ticket | One thin slice of an epic (or a standalone fix) with acceptance criteria. One ticket = one branch = one PR. |
| Run | One session doing one station's work on one ticket, then ending. |
| Station | A step a ticket passes through: Intake, Shape and slice, Build, Verify, Review, Merge, Release, Learn. |
| Door | The PR label that sets the next release's version: `one-way` major, `two-way` minor, `none` patch, `docs` no release. |
| Traffic light | `green`, `yellow`, `red` or `off`, set from your usage limits. Runs stop or slow down on their own when it changes. |
| Eject | A run stopping to hand you a decision. The ticket gets `state:needs-human` and a comment with the options and its pick. |

## A session, start to finish

1. **Switch it on: `/factory-start`.** It picks up any run that vanished without saving its place, sets the traffic light from your current usage, starts the watchdog session that keeps the light up to date, and then runs `/factory`. Nothing starts the factory but you.
2. **See where things stand: `/factory`.** It shows what needs you, what's running (out of how many slots), which tickets are ready to start, and what the next release would hold. Then it starts runs for ready tickets, each in its own session and worktree, as far as the light and slots allow. Run it again whenever you want an update or to start more work.
3. **Feed it.** Give `/factory` anything new and it goes through Intake first:
   - an idea: `/factory add a CSV export of the budget`
   - a bug: `/factory the review page freezes after 500 rows`
   - an existing issue: `/factory #142`
   - an epic from the roadmap, to shape it into tickets: `/factory Accounts and debts`
4. **Answer what needs you.** Tickets labelled `state:needs-human` carry a comment with what happened, the options and the run's pick. Reply on the issue (or tell `/factory`), and the next `/factory` picks the answered ones up first. Some stations also wait for your yes before they move on (see the trust dial below).
5. **Merge.** Reviewed PRs wait for your yes before they merge.
6. **Release: `/factory release`.** It reads the door labels merged since the last tag, proposes the version (largest door wins; only `door:docs` means nothing to release), prepares the release PR and tags only after your yes. Pushing the tag builds the `.deb` and publishes the GitHub Release.
7. **Switch it off: `/factory-shutdown`.** `now` stops every run at its next safe point; `drain` lets in-flight runs finish their current station first.
8. **See how it went: `/factory-digest`.** A local HTML page of the factory run: what shipped, what waits on you, how each station did, and at most three proposed changes to the factory itself.

## How much it does without asking

Each station has a trust level, from 0 (it only proposes; nothing happens without your yes) to 3 (it moves on and you audit about one in five). New factories start cautious: Shape and slice, Merge and Release always wait for you; Build and Verify move on and you review afterwards. A station earns one level after 10 clean passes in a row and loses one when it lets a defect through; the factory proposes each change and you confirm it. The current table is in [`spine.md`](.claude/factory/spine.md#trust-dial).

## Good to know

- **Where state lives.** Public state is GitHub: issues, labels, comments and PRs. Local state (the light, the run log, digests and private security items) is in `.git/factory/` of your checkout, never committed.
- **Security findings stay private.** Anything a public issue would teach an attacker goes to the local private list, and its branch, commits and PR use neutral wording.
- **Models.** Which model and effort each role uses is in [`.claude/factory/models.md`](.claude/factory/models.md). Change one row at a time so its effect shows.
- **Verify is partly manual for now.** Until tauri-driver is set up, the verifier drives what it can through the snapshot harness and lists the rest as manual checks in the PR comment, so read that comment before you merge.
- **One real app at a time.** The dev build uses port 1420, so only one run can drive the real app at once; others wait their turn.
- **The factory board** is a local live page of all this: `node tools/factory-board/server.js`, then <http://127.0.0.1:4317/>. How to run, simulate and self-check it: [`tools/factory-board/README.md`](tools/factory-board/README.md).
- **The roadmap** of epics is [`plans/ROADMAP.md`](plans/ROADMAP.md).
