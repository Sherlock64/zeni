# Zeni

Personal finance desktop app: import bank data, build a budget, analyze spending with AI. Built with Tauri 2, Rust and React.

## Prerequisites (Pop!_OS)

- Rust: https://rustup.rs
- Node.js and pnpm
- System libraries:

```sh
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev build-essential
```

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
