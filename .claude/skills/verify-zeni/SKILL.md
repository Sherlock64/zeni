---
name: verify-zeni
description: Drive the real Zeni debug build with tauri-driver and webdriverio on a throwaway, seeded data folder, and capture screenshots and page timings at 800x600 and 1920x1080. Use as the verifier (guides/verify.md) to check a ticket's runtime criteria in the real app.
---

# verify-zeni

From the worktree root:

```sh
node scripts/verify/run.ts <ticket>            # builds first: pnpm tauri build --debug --no-bundle
node scripts/verify/run.ts <ticket> --no-build # reuse src-tauri/target/debug/zeni
```

What it does, in order: build the debug app (embeds the frontend, so no dev server and no port 1420), run `scripts/verify/preflight.sh`, write the seed file with `scripts/seed-dev.sh` (1,200 fake OFX rows, same bytes every run), start `tauri-driver` on port 4444 with `XDG_DATA_HOME` pointing at a fresh temp folder and `GDK_BACKEND=x11`, complete setup with the dev password, click **Import file** and type the seed path into the native picker with `xdotool` (Ctrl+L, path, Enter), then visit every page at 800x600 and 1920x1080. Output in `snapshots/t<ticket>/`: `<page>-<size>.png`, `verify-report.json` (import summary and per-page timings), `failure.png` on a crash. It fails if the real database file's hash changed.

## Safety

- The binary must be `src-tauri/target/debug/zeni`: only debug builds use `dev/zeni.db` and the keyring item tagged `zeni-dev` (`db.rs`, `keyring.rs`).
- The data folder is a throwaway under the system temp dir, never `~/.local/share/com.sherlock64.zeni`; the preflight refuses the real folder. Setup does replace the `zeni-dev` keyring item (dev data only).
- The dev master password is `zeni-dev-verify-pw`, test-only, for the throwaway database; never use a real password.
- Shortcut: the real keyring item is protected by the debug-binary guard, not read back (no keyring tool installed); revisit if a read-only keyring check becomes available.

## Needs

`tauri-driver`, `WebKitWebDriver`, `xdotool` and `webdriverio` (installed by `pnpm install`); install steps in `docs/verify.md`. The preflight names each missing tool. Only one run at a time (port 4444 and the keyboard). Do not touch the keyboard or mouse while it runs: `xdotool` types into the focused window.

## Beyond the built-in pages

For a ticket's own criteria, copy `scripts/verify/run.ts` into `snapshots/t<ticket>/` (gitignored), adjust the import paths, and add the steps after the import. Real-app screenshots stay local.
