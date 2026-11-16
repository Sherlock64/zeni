# Factory workflow

How Zeni's Claude Code agents and skills (`.claude/`) turn a request into a pull request. The rules live in the skills; this page is the map.

## Routing

```mermaid
flowchart TD
  Req["User request"] --> Q{"What kind?"}
  Q -- "question, no code change" --> Inv["investigate"]
  Q -- "bug or small fix<br/>issue or SB-n" --> Fix["fix-bug<br/>brief as story S1"]
  Q -- "clean up factory-bug issues" --> FC["factory-cleanup<br/>one story per issue"]
  Q -- "major or minor version" --> HasPRD{"PRD exists?"}
  HasPRD -- no --> WP["write-prd<br/>grill, PDF summary, one yes"]
  WP --> BV
  HasPRD -- yes --> BV["build-version"]
  FC --> BV
  Inv -. "novel or high-risk" .-> DC["Design check<br/>2-3 Plan agents, ADR"]
  Fix -. "novel or high-risk" .-> DC
  BV -. "novel or high-risk" .-> DC
```

## build-version

```mermaid
flowchart TD
  Plan["Plan: PRD tasks S#-T# become the task graph<br/>files, acceptance proof, contracts.md, waves"] --> Waves
  Waves["Code waves: core-dev + ui-dev in parallel<br/>one owner per file; reports with COVERS"] --> Cov["coverage.md<br/>criterion to test map"]
  Cov --> Int["Integration: scripts/check.sh integration<br/>writes evidence.yaml"]
  Int --> Docs{"Docs or workflow changed?"}
  Docs -- yes --> DW["docs-writer and/or prompt-engineer"]
  Docs -- no --> Council
  DW --> Council["council-review<br/>members selected by risk"]
  Council -- "blocking findings" --> FixW["Fix waves to the file owners"]
  FixW --> Int2["Integration again"] --> Re["Targeted re-review:<br/>members with findings, affected dimensions,<br/>prd-compliance every round"]
  Re -- "still blocking" --> FixW
  Re -- pass --> PR
  Council -- pass --> PR["PR to main, app running, metrics"]
```

`scripts/check.sh` tiers: `fast` (policy, type-check, fmt, clippy), `task` (fast plus named tests, run by each dev), `integration` (full suites, bindings freshness, evidence manifest) and `fresh` (whether the manifest still matches the tree).

## After a PR

```mermaid
flowchart LR
  PR["PR opened"] --> Retro["retrospective<br/>tally, HTML write-up in retros/"]
  Retro --> Triage["One security triage pass<br/>(council-security)"]
  Triage -- public --> Issue["factory-bug issue<br/>with a severity label, after the user's yes"]
  Triage -- private --> SB["SB-n in snapshots/security-bugs.md<br/>(gitignored)"]
```

Blocking findings, earlier rounds' failures and every `council-security` finding stay private, whatever the triage says (`build-version` step 6.2). Process ideas stay retrospective recommendations and are never filed.
