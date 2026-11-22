# UI guide

Load when a ticket touches `src/` pages, components, hooks or styles.

## How this codebase works

- Routes are defined in `src/router.tsx` with hash history; the router `Register` augmentation lives in `src/types/router.ts`. Add a nav entry to `navItems` in `src/components/app-shell.tsx` for every top-level page.
- Component props types live in `src/types/ui.ts`, never inline in the component file.
- `AppShell` gates on `security_status` (`src/hooks/use-security-status.ts`): it shows `SetupPage`, `UnlockPage` or the app. Pages inside the app can still get a `Locked` error and show it with `CommandErrorAlert`.
- Every page renders inside `Page` (`src/components/page.tsx`), which supplies the `h1` and description.
- Build labelled inputs with `TextField` (`src/components/text-field.tsx`), which wires the hint and error to the input. Put client-side checks that mirror backend rules in `src/lib/validation.ts`, like `masterPasswordErrors`; the backend still validates.
- Call the backend only through the functions in `src/lib/commands.ts`, never through `invoke`. Use `useQuery` for reads and `useMutation` for writes. Query keys live in `src/lib/query-keys.ts` (the leaf is the command name, as in `APP_INFO_KEY`); a view derived from the rows goes under the `["ledger", ...]` prefix. After a write call `invalidate(queryClient, change)` only, adding a change kind to its map when none fits; never `invalidateQueries` directly. A query used by more than one component becomes a hook in `src/hooks/`, like `use-app-info.ts`. Show failures with `CommandErrorAlert`, and give every new `AppError` kind an entry in its `nextSteps` map. `AppShell` already shows a full-page screen for `Database` errors, so pages don't handle the database being unavailable themselves. While a query or mutation is busy, set `aria-disabled` on its button and guard the handler, instead of `disabled`, so keyboard focus stays put (see `src/pages/settings.tsx`). Test busy state and repeat presses for every mutation button. A mutation whose request or response carries a secret sets `gcTime: 0` (see `src/pages/unlock.tsx`).
- Every data view has loading (`Skeleton`), empty (`Empty`) and error states.
- The app is dark-only (`class="dark"` on `<html>`). Use theme tokens (`bg-background`, `text-muted-foreground`, `destructive`, and so on); never use raw colour values.
- Add shadcn primitives with `pnpm exec shadcn add <component>`, and don't hand-edit files in `src/components/ui/`. When it asks to overwrite an existing file there, answer no: `button.tsx` carries house styles such as `aria-disabled:opacity-50`. If the command wants to install an npm package, stop and report it as a dependency to approve.
- Icons come from `lucide-react`, with `aria-hidden="true"` when they are decorative.
- Display money only through `formatCents` in `src/lib/money.ts`.
- Tests sit next to the file they test as `*.test.tsx`. Mock `@/lib/commands` with `vi.mock`, reset with `beforeEach(() => vi.resetAllMocks())` (define global stubs such as `matchMedia` and `scrollTo` as plain functions, so the reset doesn't wipe them), render inside a fresh `QueryClientProvider` with `retry: false`, give tests that route a fresh router with `createMemoryHistory` (see `src/components/app-shell.test.tsx`), and query by role or text. Radix `Select` and `RadioGroup` need a `ResizeObserver` stub (see `src/components/import-controls.test.tsx`); Radix `Select` can't be opened in jsdom, so check its options in a snapshot.
- A dialog opened without a trigger (`open` state only) passes `onCloseAutoFocus` that calls `event.preventDefault()` and focuses the button that opened it, like `returnFocus` in `src/components/csv-layouts-card.tsx`.

## Before you report

- Every dialog, and every retry that replaces its button, returns focus to a sensible control.
- Every async state (loading, error, retry that fails again, cancel) has a test.
- User-facing labels reuse the epic's words for each concept.
- When the version adds a file format, grep `src/` for every format list (for example `OFX or QFX`) and update each one.

## Snapshots

Check what you built by looking at it, not by reading the code. Tests prove behaviour; snapshots prove it looks right.

- `snapshot.html` loads the real app in a plain browser with IPC answered by `src/snapshot.ts` from the fake responses in `src/lib/snapshot-fixtures.ts`, keyed by command name. Add a fixture for every command your pages call, using the command's binding type. Query parameters pick the state:
  - `?status=needsSetup|locked|unlocked` (default `unlocked`), `?reason=<LockReason>` for `locked` (default `keyringLocked`), `?keyringSaved=false`, `?codesLeft=<n>` (default 8).
  - `?accounts=empty`, `?imports=empty`, `?layouts=empty`, `?nicknames=empty` and `?transactions=empty` answer `list_accounts`, `list_imports`, `list_csv_layouts`, `list_nicknames` and `list_transactions` with no rows. `?balances=1` adds running balances to `list_transactions`.
  - `?import=cancel` answers `import_file` with `null` (picker cancelled); `?import=mapping|review|csv|mismatch` answers it with the CSV mapping dialog, the duplicate review dialog, or a CSV summary whose running balance passed or mismatched.
  - `?fail=<command>[:<Kind>]` makes that command reject with that `AppError` kind (default `NotFound`). Repeatable. The message is `errorMessages["<command>:<Kind>"]` in `snapshot-fixtures.ts` when present, else `errorMessages["<Kind>"]` if a kind was given, else `Snapshot failure for <command>`.
  - `?fill=<input name>=<value>`, `?click=<text>` and `?contextmenu=<row text>` run in URL order after load, to reach states behind a form submit, dialog or menu. `?click=` matches a button or `role=menuitem` by text or `aria-label` (it opens Radix dropdown triggers too); `?contextmenu=` right-clicks the first table row containing the text.
- Start `pnpm dev` in the background for snapshots (port 1420) and stop it with TaskStop when done. Parallel runs each need their own port: `pnpm dev --port <free port>`, and `ZENI_VITE_PORT=<that port> scripts/snapshot.sh ...`.
- Capture only the states your task changed (success, empty, error; loading if it is visible for long):
  `scripts/snapshot.sh 'snapshot.html?fail=app_info#/settings' snapshots/t<issue>/settings-error.png`
  An optional third argument sets the size (default `1280x800`); also capture `800x600`, only for pages with a table.
- Open every PNG with Read and check it against the ticket and the existing pages: layout, alignment, spacing, overflow, truncation, empty space, readable contrast, and that the state shown is the one intended. Fix what's wrong and capture again.
- `snapshots/` is gitignored. List every PNG you kept in `SNAPSHOTS`.
