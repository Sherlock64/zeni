# Zeni

Personal finance desktop app: import bank data, build a budget, analyze spending with AI. Built with Tauri 2, Rust and React.

## Prerequisites (Pop!_OS)

- Rust: https://rustup.rs
- Node.js and pnpm
- Optional: [Ollama](https://ollama.com), to categorize with a local model. Zeni contacts it only on `127.0.0.1`.
- A freedesktop Secret Service provider, such as `gnome-keyring-daemon` (the default on Pop!_OS). Without one, Zeni still works but asks for the master password at every start.
- System libraries:

```sh
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev build-essential
```

## Install

Install the `.deb` from GitHub Releases, update it and uninstall it: [docs/install.md](docs/install.md).

## First run

Zeni opens a setup screen on first launch: set a master password, add the checking account, and save the 8 recovery codes it shows. Where the data lives, what is encrypted, and how recovery works: [docs/security.md](docs/security.md).

To import bank transactions from OFX, QFX or CSV files: [docs/importing.md](docs/importing.md).

To back up and restore your data: [docs/backup.md](docs/backup.md).

To give transactions short names: [docs/nicknames.md](docs/nicknames.md).

To categorize transactions, with or without a local Ollama model: [docs/categories.md](docs/categories.md).

How the app fits together: [docs/architecture.md](docs/architecture.md). How the Claude Code agents build it: [docs/workflow.md](docs/workflow.md). To run that agent "factory" yourself: [how-to-factory.md](how-to-factory.md).

## Commands

```sh
pnpm install
pnpm tauri dev      # run in dev mode (own database under dev/; import the files in samples/)
pnpm test           # frontend tests
pnpm tauri build    # release build (.deb in src-tauri/target/release/bundle/deb/)

cd src-tauri
cargo test          # Rust tests
cargo fmt --check && cargo clippy --all-targets -- -D warnings   # lint
```

Roadmap and PRDs: [plans/](plans/).
