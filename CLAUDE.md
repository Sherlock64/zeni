# Zeni

Personal finance desktop app: Tauri 2, Rust + sqlx/SQLite backend, TypeScript + React frontend, pnpm.

## Rules

- Keep types in dedicated type modules, separate from logic: Rust in `src-tauri/src/types*`, UI in `src/types/`. Exception: the shadcn CLI owns and regenerates `src/components/ui/` and `src/hooks/use-mobile.ts`.
- Do not add a dependency (Cargo or npm) without asking first.
- Store and compute money as integer cents. Never use floats for money.
- Never modify raw imported data.
- Encrypt only account and routing numbers; everything else is plain text by design (scope: `docs/security.md`). Encrypt and decrypt only through `crypto.rs`.
- Never log, `Debug`-print or put in an error message a key, password, recovery code or account/routing number. Types holding them do not derive `Debug`.
- Prefer mature, well-documented libraries.
- Stop and ask at marked checkpoints.
- Start each session on one fresh branch from the latest `origin/main`, and keep all of that session's work on it. Name it `v<version>-<one or two words>`. Versions are semantic (major.minor.hotfix) with trailing zeros dropped: `v3` is 3.0.0, `v3.1` is 3.1.0, `v3.0.1` is a hotfix on `v3`. Major work massively changes how the app works as a whole (backup and restore, nicknames, categorisation) or may modify or remove what users already have (dropping tables, changing or removing UI features, changing settings the user may have set). Minor work only adds, without changing how the app works as a whole (new tables, new features, slow patches). Hotfixes are urgent fixes, very small harmless changes, and documentation changes, including PRDs and the roadmap. Major and minor work needs a PRD and takes its version (`PRD-V3.1.md` -> `v3.1-<words>`); a hotfix needs no PRD and takes the next hotfix number after the latest version merged to `main` (`v3.0.1-...`, then `v3.0.2-...`). PRs target `main`.

## Workflow

| Request | Playbook |
|---|---|
| Question or investigation, no code change | `investigate` skill |
| Bug or small fix (or a GitHub issue: `#<issue>`) | `fix-bug` skill |
| Clean up all factory-bug issues | `factory-cleanup` skill (one minor version) |
| PRD version (major or minor) | `build-version` skill (`write-prd` first if there is no PRD) |
| Novel or high-risk technical decision | `build-version` Design check |

## Layout

- `src-tauri/src/`: Rust backend: `commands.rs` (thin Tauri wrappers), `db.rs` (also the shared `app_meta` read/write helpers), `types.rs`, `crypto.rs` (AES-256-GCM, Argon2id, recovery codes), `keyring.rs` (Secret Service via oo7; `Keyring` trait, faked in tests), `security.rs` (setup, unlock, recover, reset, session key), `accounts.rs` (validation, encrypted insert, list, reveal), `ofx.rs` (hand-written OFX 1.x SGML / 2.x XML parser), `csv_import.rs` (pure CSV header, mapping preview and parse, running-balance check), `csv_layouts.rs` (saved CSV layouts: mapping validation, CRUD), `imports.rs` (two-step import: preview holds the parsed file in `AppState.pending_import`, then commit or cancel; dedupe, cross-format suspects, balance check, revert), `transactions.rs` (paged list query), `backup.rs` (`VACUUM INTO` backups, retention, daily and pre-revert backups, validated restore with a safety copy, undo restore), `nicknames.rs` (matching engine, rule CRUD, stale setting; `match_import` is called by import commit), `categories.rs` (flat category list: CRUD, reorder, delete with replacement), `overlay.rs` (set a row's category and note, or many rows' category with `set_many`; reads the `effective_categories` view), `ollama.rs` (client for Ollama on `127.0.0.1` only; settings, status, download), `jobs.rs` (the single Ollama job slot polled through `job_status`; a cancel signal stops the in-flight Ollama request at once; restore awaits it), `categorize.rs` (`Categorizer` trait, categorize run, `after_import`; guarded model write), `review.rs` (unreviewed model groups), `builds.rs` (model builds, trimmed to the Ollama context window), `spending.rs` (shared spending query: transfers excluded, refunds reduce spending), `import_acceptance_tests.rs` (V3 acceptance tests over the fixtures), `version.rs` (`APP_VERSION`, semver parse), `startup.rs` (runs before the UI, holds the continue-startup logic the commands call: compares last run version with the app version, takes the `pre-update` backup, then migrates; blocks on a failed backup or newer data), `updates.rs` (daily update check: one `GET` to GitHub Releases, the only call outside the machine; Ollama on `127.0.0.1` is the only other network call), `release_notes.rs` (parses the built-in `CHANGELOG.md`)
- `src-tauri/migrations/`: SQL migrations
- `src-tauri/deb/postrm`: `.deb` post-remove script; on purge it only prints where the data is. `src-tauri/icons/zeni-icon.svg`: the app icon source (the `-alt-` SVGs are unused backups); regenerate PNGs with `pnpm tauri icon`
- `.github/workflows/`: `ci.yml` (workflow `CI`: `scripts/check.sh integration` plus `pnpm tauri build` on pull requests) and `release.yml` (on a `v*.*.*` tag: `scripts/release-check.sh`, build the `.deb`, `gh release create`); first-party `actions/*` only
- `CHANGELOG.md`: one `## <version>` heading per version, newest first, each with `- ` bullets; the release notes and the in-app What's new dialog read it
- `src-tauri/tests/fixtures/`: fake OFX/QFX/CSV files; their README lists the expected import results
- `samples/`: three consecutive fake months (OFX, QFX, CSV) for manual testing in a dev build; never use real exports
- `src/`: React UI (`pages/`, `components/`, `lib/`, `hooks/`). `components/app-shell.tsx` shows `pages/setup.tsx` or `pages/unlock.tsx` instead of the app until `security_status` is `unlocked` (`hooks/use-security-status.ts`). `components/import-controls.tsx` holds import, import history and revert on the Transactions page and opens `csv-mapping-dialog.tsx` (built on `csv-mapping-form.tsx`) or `duplicate-review-dialog.tsx`; `components/csv-layouts-card.tsx` lists, edits and deletes saved layouts in Settings; `components/backup-card.tsx` is the Backups card in Settings (folder, retention, back up now, restore); `pages/unlock.tsx` offers Undo restore after a restore; `pages/nicknames.tsx` is the Nicknames page; `components/rename-dialog.tsx` (right-click Rename it on Transactions) and the Nicknames card in Settings use `components/nickname-rule-fields.tsx`; `pages/categories.tsx` (list, drag reorder with `category-form.tsx`, `category-delete-dialog.tsx`), `pages/review.tsx` (with `components/review-group-section.tsx` and `review-row.tsx`), `components/categorize-dialog.tsx` and `category-select.tsx` (set a category and note), `categorize-actions.tsx` and `categorize-banner.tsx` (Categorize now, Recategorize all, job banner on Transactions), `ollama-card.tsx` (Settings; with `model-builds-section.tsx` and `auto-categorize-switch.tsx`), `hooks/use-job-status.ts` (polls `job_status`), `text-size-card.tsx` (Settings) with `hooks/use-text-size.ts` (root font size, localStorage `zeni.textSize`, Ctrl shortcuts); `pages/startup-problem.tsx` (backup failed, newer data; `hooks/use-startup-status.ts`), `components/update-banner.tsx` (`hooks/use-update-status.ts`), `components/about-card.tsx` (Settings > About: version, update check) and `release-notes-dialog.tsx`; `lib/money.ts` formats integer cents
- `src/types/`: UI types (`command.ts`, `ui.ts`, `router.ts`); `src/types/bindings/` is generated by ts-rs and committed
- `src/components/ui/`: shadcn components; they import `cn` from the `cn` package
- `scripts/`: dev scripts; `release-check.sh` (release gate: tag matches the app version and `CHANGELOG.md` has its section; self-test `release-check.test.sh`); `check.sh` is the verification gate (`check.test.sh` self-tests it; what it enforces: `CONSTRAINTS.md`); `snapshot.html` + `src/snapshot.ts` are the dev-only mocked-IPC entry for snapshots (not in the release build)
- `plans/`: PRDs (user stories with `S#-T#` tasks; format: `write-prd` skill) and roadmap
- `docs/`: user guides (`install.md` covers install, update, uninstall and required checks; `categories.md` covers Ollama, review and builds; `text-size.md`); `architecture.md` (component and flow diagrams), `workflow.md` (agent workflow diagrams), `glossary.md` (domain terms), `database.md` (schema detail), `adr/` (architecture decisions, `0001` is the effective-category and job-slot design; when to write one: `adr/README.md`)
- `.claude/`: agent and skill definitions

## Commands

Run Rust commands in `src-tauri/`.

- Dev: `pnpm tauri dev`
- Test: `pnpm test` and `cargo test`
- Lint: `cargo fmt --check && cargo clippy --all-targets -- -D warnings`
- Checks (repo root, `scripts/check.sh`): `fast` (policy, `pnpm exec tsc`, fmt, clippy); `task [--rust <filter>]... [--ts <path>]...` (fast plus those tests); `integration [--evidence snapshots/V<n>/evidence.yaml]` (fast, full tests, bindings freshness, optional evidence manifest); `fresh <evidence.yaml>` (`FRESH` only if the tree is unchanged since the manifest and every result passed). Self-test: `scripts/check.test.sh`
- Release build: `pnpm tauri build`
- App version: `version` in `src-tauri/Cargo.toml` and `package.json` must be equal; the release tag `v<version>` must match it. A new version adds its `CHANGELOG.md` section.
- CI: the `CI` workflow (`.github/workflows/ci.yml`) runs on pull requests to `main` and pushes to `main`, with `ZENI_DEPS_APPROVED=1 ZENI_SUPPRESSIONS_APPROVED=1 scripts/check.sh integration`
- UI snapshot (with `pnpm dev` running): `scripts/snapshot.sh '<page>' <out.png>`, for example `scripts/snapshot.sh 'snapshot.html#/settings' snapshots/settings.png`; it mocks IPC with `src/lib/snapshot-fixtures.ts`
- Regenerate bindings: `cargo test export_bindings`; commit the changes in `src/types/bindings/`

## Database

- Lives at `~/.local/share/com.sherlock64.zeni/zeni.db`. The folder is 0700 and the file 0600; keep it that way.
- Debug builds (`pnpm tauri dev`) use `~/.local/share/com.sherlock64.zeni/dev/zeni.db` and tag keyring items `zeni-dev`, so dev runs never touch the user's real data. Test erase, restore and migrations only there or in temp-dir tests; never point a dev build at the real database.
- Migrations live in `src-tauri/migrations/` and run on startup. A migration that rebuilds a table other tables reference starts with `-- no-transaction` and runs `PRAGMA foreign_keys = OFF` before its own `BEGIN` (see `0004_csv_import.sql`); dropping the table with foreign keys on cascade-deletes the child rows.
- Never edit an applied migration; add a new one.
- Imported data is never updated: triggers abort every `UPDATE` on `raw_transactions` and on the file-read columns of `imports`. Reverting an import hard-deletes it and its rows.
- `AppState.db` is a `RwLock` that a restore swaps; `security::pool` returns a clone of the pool, so never hold the lock across an `await`.
- Tables, columns, triggers and `app_meta` keys: `docs/database.md`.
