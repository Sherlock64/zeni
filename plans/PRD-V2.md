# Personal Finance App — V2 PRD: Security

V2 adds the accounts table and protects sensitive account details with field-level encryption, before any bank data is imported. Builds on PRD-V1.md; see ROADMAP.md.

## Requirements

- **V2-R1:** Accounts table: ID, name, owner (person name, defaults to the user), bank name, account number, routing number.
- **V2-R2:** Account and routing numbers are encrypted at field level with AES-256-GCM, so they stay ciphertext in the database even while the app is running.
- **V2-R3:** The encryption key is stored via the freedesktop Secret Service API (GNOME Keyring today, oo7 later), which unlocks at login, so only the user's session can read it.
- **V2-R4:** Master-password fallback: when the keyring is locked or unavailable, the app derives the key from a master password using Argon2.
- **V2-R5:** First-run setup: create the key, set the master password, and add the checking account.
- **V2-R6:** Locked-keyring detection, with an unlock prompt instead of a hang or crash.
- **V2-R7:** Account details screen: decrypted numbers are shown only on request (e.g. a reveal button) and are never logged.
- **V2-R8:** Documented scope: only account and routing numbers are encrypted; all other data stays plain text by deliberate choice, protected by Linux file permissions and disk encryption if enabled.

## Out of Scope

- Importing transactions (V3).
- Multiple accounts (V9).

## Edge Cases

- **Keyring restarts mid-session** (a known COSMIC issue): the app detects the locked keyring and falls back to the master-password prompt.
- **Forgotten master password with a locked keyring:** encrypted fields cannot be recovered; the app explains this and allows re-entering the account details.

## Acceptance Criteria

1. First-run setup creates the key, stores it via Secret Service, sets a master password, and saves the checking account.
2. Opening the SQLite file directly shows account and routing numbers only as ciphertext.
3. With the keyring unlocked, the app opens without asking for a password.
4. With the keyring locked or unavailable, the app asks for the master password and works normally after it is entered.
5. A wrong master password is rejected and no data is decrypted.
6. Account and routing numbers are shown only after the user asks to reveal them, and never appear in logs.
7. The encryption scope statement is present in the app's documentation.
