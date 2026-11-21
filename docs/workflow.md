# Factory workflow

How Zeni's Claude Code factory (`.claude/`) turns a request into a release. The rules live in `.claude/factory/spine.md` and the station guides; this page is the map.

## Units

```mermaid
erDiagram
  REQUEST }o--o| EPIC : "shapes into"
  REQUEST }o--o| TICKET : "or becomes"
  EPIC ||--|{ TICKET : "splits into"
  TICKET }o--o{ TICKET : "blocked by"
  TICKET ||--|{ RUN : "worked by"
  TICKET ||--o| PR : "lands as"
  RELEASE ||--|{ PR : "ships"
```

The issue number ties them together: branch `t<issue>-<words>`, `Closes #<n>`, ticket comments, the changelog bullet. An epic is not a release.

## Stations

```mermaid
flowchart LR
  IN["Intake<br/>sort requests"] --> SH["Shape + slice<br/>epic issue, tickets"]
  IN -- "small and clear" --> BU
  SH --> BU["Build<br/>one owner, test-first"]
  BU --> VE["Verify<br/>fresh verifier, real app"]
  VE --> RV["Review<br/>5 seats by risk,<br/>block only with proof"]
  RV -- "proven blocker" --> BU
  RV --> ME["Merge"]
  ME --> RE["Release<br/>on the user's yes"]
  RE --> LE["Learn<br/>sampled retros"]
  LE -. "at most 3 changes" .-> IN
  RV -. "follow-ups" .-> IN
  BU & VE & RV -. "eject" .-> NH["needs-human<br/>brief on the ticket"]
  NH -. "answered" .-> BU
```

Each ticket carries one `state:` label: `intake`, `shaping`, `ready`, `building`, `verifying`, `reviewing`, `merged`, `released`, `needs-human`.

## Dispatch

```mermaid
flowchart TD
  You["/factory, with optional input"] --> Read["Read state: issues and labels, PRs and CI,<br/>commits since last tag, light.json, runs.tsv, private count"]
  Read --> In{"New input?"} -- yes --> Intake["Intake"]
  In -- no --> Pick
  Intake --> Pick["Pick: answered ejects, failing PRs,<br/>frontier tickets, intake backlog"]
  Pick --> Gate{"Light green and a slot free?<br/>Trust level lets it run?"}
  Gate -- no --> List["List it for the user"]
  Gate -- yes --> Claim["Claim: state:building + comment"] --> Spawn["start_session per ticket,<br/>own worktree, model from models.md"]
```

## Factory run and the traffic light

```mermaid
flowchart LR
  Start["/factory-start<br/>pickup, light, watchdog"] --> Run["runs read light.json<br/>at every pivot"]
  WD["watchdog session<br/>every 10-20 min: get_usage"] -- "green / yellow / red,<br/>slots from weekly pace" --> Run
  Run --> Shut["/factory-shutdown<br/>now: off · drain: yellow, then off"]
  Shut --> Dig["/factory-digest"]
```

The 5-hour window sets the light (green under 70%, yellow 70-89%, red 90%+). The weekly window is paced into 3, 2, 1 or 0 slots and turns the light red at 97%. A light older than 45 minutes counts as yellow.

## Release

```mermaid
flowchart LR
  M["PRs merged since last tag"] --> D{"largest door"}
  D -- "door:one-way" --> Maj["major"]
  D -- "door:two-way" --> Min["minor"]
  D -- "door:none" --> Pat["patch"]
  D -- "only door:docs" --> No["no release"]
  Maj & Min & Pat --> RP["release PR: bump version,<br/>## Unreleased → ## x.y.z"] --> Tag["tag v x.y.z, on the user's yes"] --> GH["Release workflow:<br/>release-check.sh, .deb, GitHub Release"]
```

## Checks

`scripts/check.sh` tiers: `fast` (policy greps from `CONSTRAINTS.md`, type-check, fmt, clippy), `task` (fast plus named tests), `integration` (full suites, bindings freshness, optional evidence manifest) and `fresh`. CI runs `integration` and both self-tests; the `Door` workflow checks each PR's label.
