# Zeni

Personal finance desktop app: import bank data, build a budget, analyze spending with AI. Built with Tauri 2, Rust and React.

## Prerequisites (Pop!_OS)

- Rust: https://rustup.rs
- Node.js and pnpm
- A freedesktop Secret Service provider, such as `gnome-keyring-daemon` (the default on Pop!_OS). Without one, Zeni still works but asks for the master password at every start.
- System libraries:

```sh
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev build-essential
```

## First run

Zeni opens a setup screen on first launch: set a master password, add the checking account, and save the 8 recovery codes it shows. Where the data lives, what is encrypted, and how recovery works: [docs/security.md](docs/security.md).

## Commands

```sh
pnpm install
pnpm tauri dev      # run in dev mode
pnpm test           # frontend tests
pnpm tauri build    # release build (.deb)

cd src-tauri
cargo test          # Rust tests
cargo fmt --check && cargo clippy --all-targets -- -D warnings   # lint
```

Roadmap and PRDs: [plans/](plans/).
