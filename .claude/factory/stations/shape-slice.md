# Shape and slice

One session with the user: settle the decisions, write the epic, cut it into tickets.

**Outcome:** an epic issue whose body is the spec, and its tickets as sub-issues, each a thin end-to-end slice one fresh session can build.

**Done when:** no decision is open, every acceptance criterion in the epic sits in exactly one ticket, and the user said yes to the epic and the tickets before you published them. Tickets with no open blocker go to `state:ready`; the rest stay `state:shaping` until their blockers close.

## Shape

- Read `plans/ROADMAP.md` (its Product preferences decide product questions), `docs/glossary.md`, and the code and schema the epic touches. Answer from them whatever you can; ask only what they leave open.
- Ask directly, a few questions at a time, each with your recommended answer and why. Settle scope first, then each behaviour, its errors and edges. Settle a name for every new domain term.
- Novel or high-risk technical decisions (encryption, keys, a table rebuild, concurrency, a hard-to-reverse external interface) get a design check: 2-3 `Plan` agents with structurally different approaches, one pick, and an ADR ticket (`docs/adr/README.md`).
- The epic body: what it adds and why, the decisions (one line each), each rule or formula once with a worked example per edge, new terms, out of scope, and approved dependencies by name.

## Slice

- A ticket is vertical: backend to UI, testable end to end. Its body has the behaviour, acceptance criteria phrased as what a user sees or a command returns or stores, the modules or interfaces it touches, and `Blocked by: #a, #b`. No file paths or code.
- Mark a criterion `runtime` when only the running app can show it.
- Keep tickets small enough that two can run side by side: prefer tickets that name different modules. Foundation work (shared types, a migration) is its own first ticket that the others are blocked by.
- Give each ticket's PR the door it will likely carry, so the user sees the release impact.

## Publishing

Show the epic and the ticket list as one page (title, criteria count, modules, blocked by, door) and get one yes to that page. Yeses to your questions settle answers; they are not the publishing yes. Then create the epic, the tickets, and link each as a sub-issue of the epic. Creating labels is the user's call. The run comment quotes the user's publishing yes word for word. A shape PR (a design or an ADR) carries only the deliverable the user chose, never the other directions or drafts; the Spec seat blocks it otherwise. Then log the run and end; the dispatcher starts the Build runs.

## Eject when

The user isn't available for a decision the epic can't proceed without. Shaping never guesses a product decision.

## Pointers

Ticket states: `spine.md`. Next: `stations/build.md`.
