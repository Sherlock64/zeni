---
name: add-command
description: Add or change a typed Tauri command in Zeni, end to end from the Rust types, validation and logic through the thin Tauri wrapper and ts-rs bindings to the src/lib/commands.ts wrapper and tests. Use whenever the UI needs a new backend call or a command's request, response or errors change.
---

# Add a command

The reference implementations are `app_info` / `load_app_info` (a database read behind a thin wrapper) and `sample_error` (validated input). Every step below is `core-dev` work. Paths are relative to the repo root.

1. **Types** go in `src-tauri/src/types.rs`, or the `types` module once it is split. Each type needs `#[derive(TS)]`, `#[ts(export)]` and `#[serde(rename_all = "camelCase")]`.
   - Request: `#[derive(Debug, Deserialize, TS)]`, named `<Name>Request`.
   - Response: `#[derive(Debug, Serialize, TS)]`.
   - Money fields: `i64` cents with `#[ts(type = "number")]`. Without it, ts-rs emits `bigint`, which doesn't match the JSON number serde sends.
   - Errors: use `AppError::Validation` for bad input. `sqlx`, migrate and `std::io` errors become `AppError::Database` through the `From` impls, so use `?`. A new kind gets a variant holding one `String`, with `#[error("{0}")]`. A unit variant would serialize without `message` and break `CommandError`.
2. **Logic** goes in a private plain function in `src-tauri/src/commands.rs`, which knows nothing about Tauri. Only its wrapper and tests call it, so it gets no `pub`:
   ```rust
   async fn <logic_name>(state: &AppState, request: <Name>Request) -> Result<<Response>, AppError>
   ```
   - If it needs the database, get it first. While the database is unavailable this returns `AppError::Database`:
     ```rust
     let database = state.db.as_ref().map_err(|error| AppError::Database(error.clone()))?;
     ```
   - Put queries in `db.rs` or a domain module, and call them with `&database.pool`.
   - Drop `async`, `state` or `request` when they aren't used.
3. **Validate first** in the logic function. Trim strings. Reject empty values, values over a `const MAX_...` limit, out-of-range numbers and unknown values with `AppError::Validation("<field> must ...")` before touching the database.
4. **Tauri wrapper**, the only part tests can't call:
   ```rust
   #[tauri::command]
   pub async fn <snake_name>(state: State<'_, AppState>, request: <Name>Request) -> Result<<Response>, AppError> {
       <logic_name>(&state, request).await
   }
   ```
   - Read Tauri-only inputs (`AppHandle`, package info) here and pass them in as plain values, as `app_info` does.
   - A command with no Tauri inputs and no state, like `sample_error`, is already plain and needs no wrapper.
5. **Register** the wrapper in `generate_handler![...]` in `src-tauri/src/lib.rs`. App commands need no capability, so leave `permissions: []` in `src-tauri/capabilities/default.json`.
6. **Rust tests** go in `#[cfg(test)] mod tests` of `commands.rs`. Call the plain function, not the wrapper. Cover:
   - The success path, with state from `db::connect(&db::temp_dir("<name>"))`. Remove the directory at the end.
   - Each validation rule, on both sides of every limit (for example 200 accepted, 201 rejected), and after trimming.
   - For database commands, the unavailable case: `AppState { db: Err("...".into()) }` returns `Database`.
   - Errors, asserted on their serialized `kind` with `serde_json::to_value`.
7. **Bindings:** run `cargo test` in `src-tauri/`. It writes the new files to `src/types/bindings/` (`TS_RS_EXPORT_DIR` in `src-tauri/.cargo/config.toml`). Commit them with the change, and never hand-edit them.
8. **TS wrapper** goes in `src/lib/commands.ts`, beside the existing ones:
   ```ts
   export const <camelName> = (request: <Name>Request) => call<<Response>>("<snake_name>", { request });
   ```
   - Import the types from `@/types/bindings/<Type>`.
   - A command that returns `()` uses `call<null>`.
   - Export only the wrappers.
9. **TS test** in `src/lib/commands.test.ts`: assert that `invoke` was called with `"<snake_name>"` and `{ request: ... }`.
10. **Check:** in `src-tauri/`, run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`. Then, at the repo root, run `pnpm exec tsc` and `pnpm test`.

The UI side is `ui-dev`'s work:
- Read with `useQuery({ queryKey: ["<snake_name>"], queryFn: <camelName> })`, or use `useMutation` for writes. A query used in more than one place gets a hook in `src/hooks/`, like `use-app-info.ts`.
- A new `AppError` kind needs a next step in `src/components/command-error-alert.tsx`.
