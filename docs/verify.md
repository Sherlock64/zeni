# Driving the real app (verify-zeni)

For the factory's verifier and anyone who wants to see the real debug build driven end to end. Linux only; Ubuntu 24.04 / Pop!_OS 24.04.

## Install the tools

```sh
sudo apt install webkit2gtk-driver xdotool
cargo install tauri-driver --locked
pnpm install   # brings webdriverio, a devDependency used only by scripts/verify
```

`tauri-driver` is a tool, not a project dependency. `xdotool` types the seed file's path into the native file picker, so run on an X11 or XWayland session and leave the keyboard alone during a run.

## Run

```sh
node scripts/verify/run.ts <ticket>
```

It builds the debug app, makes a throwaway data folder, completes setup with a test-only password, imports the 1,200-row fake file from `scripts/seed-dev.sh` and screenshots and times every page at 800x600 and 1920x1080 into `snapshots/t<ticket>/`. It never touches your real database or keyring item: see `.claude/skills/verify-zeni/SKILL.md` and `CONSTRAINTS.md`.

`scripts/verify/preflight.sh` lists any missing tool by name. Self-test: `scripts/verify/preflight.test.sh`.
