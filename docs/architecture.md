# Architecture

How Zeni's parts fit together, at a glance. Security details: [security.md](security.md). Schema: [database.md](database.md).

## Components and data

```mermaid
flowchart LR
  subgraph Shell["Tauri 2 shell (one desktop window)"]
    direction LR
    subgraph UI["React UI (src/)"]
      Pages["Pages: setup, unlock, accounts,<br/>transactions, review, nicknames,<br/>categories, settings"]
      Router["TanStack Router"]
      Query["TanStack Query"]
      Cmds["Typed command layer<br/>src/lib/commands.ts<br/>+ ts-rs bindings (src/types/bindings/)"]
      Router --> Pages
      Pages --> Query --> Cmds
    end
    subgraph Rust["Rust backend (src-tauri/src/)"]
      Wrappers["commands.rs<br/>thin Tauri wrappers"]
      Security["security.rs<br/>setup, unlock, recover, reset"]
      Crypto["crypto.rs"]
      Keyring["keyring.rs"]
      Accounts["accounts.rs"]
      Import["Import pipeline<br/>ofx.rs, csv_import.rs, csv_layouts.rs,<br/>imports.rs, nicknames.rs"]
      Tx["transactions.rs"]
      Backup["backup.rs"]
      Cat["Categories<br/>categories.rs, overlay.rs, review.rs,<br/>spending.rs"]
      Jobs["jobs.rs<br/>one job slot (AppState.jobs)"]
      Run["categorize.rs, builds.rs"]
      Oll["ollama.rs<br/>client, 127.0.0.1 only"]
      Wrappers --> Security & Accounts & Import & Tx & Backup & Cat & Run & Jobs
      Run --> Jobs & Oll
      Oll --> Jobs
      Backup -- "stop_and_wait" --> Jobs
      Security --> Crypto & Keyring
      Accounts --> Crypto
    end
    Cmds -- "invoke (IPC)" --> Wrappers
  end
  subgraph Data["Where data lives"]
    DB[("SQLite zeni.db<br/>raw imports: imports, raw_transactions (never updated)<br/>derived: accounts, CSV layouts, nicknames, categories, model builds, settings")]
    OSK[("OS keyring<br/>Secret Service: data key")]
    BK[("Backup folder<br/>timestamped zeni.db copies")]
    OL[("Ollama on this computer<br/>127.0.0.1:port, the only outside call")]
  end
  Oll --> OL
  Accounts & Import & Tx & Security & Cat & Run --> DB
  Keyring --> OSK
  Backup --> BK
  Backup --> DB
```

## Main flows

### Setup and unlock

```mermaid
sequenceDiagram
  actor User
  participant UI as React UI
  participant BE as Rust backend
  participant KR as OS keyring
  participant DB as SQLite
  UI->>BE: security_status
  alt first run
    User->>UI: master password, checking account
    UI->>BE: complete_setup
    BE->>DB: password-locked data key, account
    BE->>KR: save data key
    BE-->>UI: recovery codes
  else keyring holds the key
    BE->>KR: read data key
    BE-->>UI: unlocked
  else keyring locked or missing
    User->>UI: master password or recovery code
    UI->>BE: unlock (or recover)
    BE->>DB: open the password-locked data key
    BE-->>UI: unlocked
  end
```

### Import: preview, then commit

```mermaid
sequenceDiagram
  actor User
  participant UI as Transactions page
  participant BE as imports.rs
  participant DB as SQLite
  User->>UI: pick an OFX, QFX or CSV file
  UI->>BE: import_file
  BE->>BE: parse (CSV: saved layout or mapping dialog)
  BE->>DB: read earlier rows (duplicates, balance)
  BE-->>UI: summary, suspected duplicates, balance check
  Note over BE: parsed file held in AppState.pending_import
  alt commit
    User->>UI: confirm (after duplicate review)
    UI->>BE: commit_import
    BE->>DB: insert import + raw transactions, match nicknames
  else cancel
    UI->>BE: cancel_import (pending import dropped)
  end
```

### Backup and restore

```mermaid
sequenceDiagram
  actor User
  participant UI as Settings, Backups card
  participant BE as backup.rs
  participant DB as SQLite
  participant BK as Backup folder
  User->>UI: Back up now (also daily and before a revert)
  UI->>BE: back_up_now
  BE->>BK: VACUUM INTO a timestamped copy, apply retention
  User->>UI: Restore a backup
  UI->>BE: pick_restore_file, restore_backup
  BE->>BE: validate the file
  BE->>BK: safety copy of the current database
  BE->>DB: swap in the restored database, then lock
  BE-->>UI: unlock screen if the keyring lacks its key, with Undo restore
```

### Categorize

The UI polls `job_status`; there are no Tauri events. One job runs at a time. Why: [ADR 0001](adr/0001-derived-effective-category-and-polled-job-slot.md). Guide: [categories.md](categories.md).

```mermaid
sequenceDiagram
  actor User
  participant UI as Transactions page
  participant BE as categorize.rs
  participant J as jobs.rs
  participant OL as Ollama (127.0.0.1)
  participant DB as SQLite
  User->>UI: Categorize now (or an import commits)
  UI->>BE: start_categorize
  BE->>J: start (Busy if a job runs)
  J-->>UI: JobStatus (running)
  loop each row, until done or cancelled
    BE->>OL: /api/chat with the category list as a schema enum
    OL-->>BE: category name
    BE->>DB: guarded write (skipped if user- or nickname-set)
    BE->>J: progress
  end
  BE->>J: outcome (summary) into last
  loop about every 500 ms while running
    UI->>J: job_status
    J-->>UI: JobStatus
  end
  User->>UI: Dismiss
  UI->>J: clear_job_outcome
```

The `effective_categories` view gives every reader the same answer: user, else nickname default, else model.
