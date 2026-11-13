# Personal Finance App — V1 PRD: App Foundation

V1 delivers a running, empty Tauri app with all the scaffolding in place, so later versions only add features. No user data is stored yet. See ROADMAP.md.

## Requirements

- **V1-R1:** Tauri 2 project with a Rust backend and a TypeScript + React frontend, using pnpm.
- **V1-R2:** Repo layout with the Rust backend and the UI in separate folders; on both sides, types live in dedicated type modules, separate from logic.
- **V1-R3:** CLAUDE.md at the repo root with coding rules: types separate from logic; no new dependencies without asking; money always as integer cents; raw imported data is never modified; prefer mature, well-documented libraries; stop and ask at marked checkpoints.
- **V1-R4:** SQLite via sqlx, with versioned migrations that run on startup. The database file lives in the user's XDG data folder.
- **V1-R5:** UI stack set up: shadcn, TanStack Router, TanStack Query.
- **V1-R6:** App shell: dark theme, sidebar navigation with placeholder Transactions and Settings pages, and empty states.
- **V1-R7:** Typed command layer between Rust and the UI: shared request and response types, and typed errors shown in the UI.
- **V1-R8:** Test setup: Rust unit tests and frontend tests, each with at least one passing example.
- **V1-R9:** Dev run and release build work on Pop!_OS (COSMIC).

## Out of Scope

- Accounts, encryption and any stored user data (V2).
- Importing and viewing transactions (V3).

## Open Questions

- App name (needed for the project, window title and data folder).

## Acceptance Criteria

1. The app launches in dev mode and as a release build on Pop!_OS.
2. The app shell shows the dark theme, sidebar navigation, and the Transactions and Settings placeholder pages.
3. On first launch, the SQLite database is created in the XDG data folder and migrations run.
4. On later launches, already-applied migrations are not re-run.
5. A sample command round-trips from the UI to Rust and back, using shared types.
6. A sample error from Rust is shown in the UI as a typed error.
7. Rust tests and frontend tests both run and pass.
8. CLAUDE.md exists and contains every rule in V1-R3.
9. Types and logic are in separate modules on both the Rust and the UI side.
