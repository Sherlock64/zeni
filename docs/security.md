# How Zeni protects your account details

Zeni encrypts your account number and routing number. This page explains how, what is not encrypted, and what to do if you lose access.

## What is encrypted

Only two values are encrypted: the **account number** and the **routing number** of each account.

Everything else is stored as plain text on purpose. That includes the account name, the owner, the bank name, and any data later versions of Zeni add, such as transactions. Plain text keeps the app simple and fast to search. It is protected by:

- **Linux file permissions.** Zeni keeps its database at `~/.local/share/com.sherlock64.zeni/zeni.db`. The folder is readable only by you (mode 0700) and the file too (mode 0600). Zeni resets these permissions every time it starts.
- **Disk encryption, if you turned it on.** Pop!_OS offers full-disk encryption at install time. Without it, anyone who takes the disk out of your computer can read the plain-text data.

## How the encryption works

- At setup, Zeni creates one random 256-bit **data key**.
- The data key encrypts each account and routing number with AES-256-GCM. Each value gets its own random nonce. The numbers stay encrypted in the database even while Zeni is running. Zeni decrypts them only when you click **Show numbers** on the Accounts page, and never writes them to a log.
- The data key itself is stored in two places:
  1. **Your system keyring**, through the freedesktop Secret Service API. Any Secret Service provider works. On Pop!_OS with COSMIC this is `gnome-keyring-daemon`, which unlocks when you log in. The item is called "Zeni data key".
  2. **The database, locked by your master password and your recovery codes.** Zeni derives a key from the password (or a code) with Argon2id and uses it to encrypt a copy of the data key. The password and codes themselves are never stored.

## First-run setup

The first time you open Zeni, it asks for:

1. A master password of at least 12 characters, typed twice.
2. Your checking account: name, owner, bank name, account number and a 9-digit routing number.

Zeni then shows 8 **recovery codes**, each like `ABCDE-FGHJK-MNPQR-STVWX`. They are shown only once. Copy them or write them down, store them somewhere safe away from this computer, and confirm with **I've saved these codes**.

If Zeni can't save its key in the keyring during setup, it tells you. Zeni still works; it asks for your master password each time it starts.

## Opening Zeni

- **Keyring unlocked:** Zeni reads its key from the keyring and opens without asking for anything.
- **Keyring locked, unreachable, or missing Zeni's key:** Zeni shows the unlock screen with the reason and asks for your master password. A wrong password is rejected and nothing is decrypted. After a correct password, Zeni saves its key back into the keyring if the keyring is unlocked, so the next start skips the prompt.

Zeni never triggers the system's own keyring unlock prompt, and it gives up on an unresponsive keyring after about 5 seconds instead of hanging.

**If the keyring restarts or locks while Zeni is open** (a known issue on COSMIC), nothing changes for the open session. Once unlocked, Zeni keeps the data key in memory until you close it. The next time you start Zeni, it asks for your master password if the keyring is still locked.

Settings > Security shows whether the key is saved in your keyring.

## Recovery codes

Use a recovery code when you forget your master password:

1. On the unlock screen, choose **Use a recovery code**.
2. Enter one of your codes. Case, spaces and dashes don't matter.
3. Choose a new master password and confirm it.

Zeni unlocks and replaces your master password. That code stops working; the others still work.

To get a fresh set, open Settings > Security while Zeni is unlocked, choose **Generate new recovery codes** and enter your master password. Zeni shows 8 new codes and all old codes stop working. Settings also shows how many codes you have left.

## If you lose everything: Erase and set up again

If you forgot your master password, have no unused recovery code, and the keyring doesn't have Zeni's key, nobody can decrypt your account and routing numbers. Not even the developer.

On the unlock screen, choose **Can't unlock?**, then **Erase and set up again**. Zeni deletes:

- every encrypted copy of the data key (password and recovery codes),
- the data key from your keyring, if the keyring is unlocked,
- the record of which key Zeni uses,
- your accounts, including their names and banks.

Zeni then returns to first-run setup, where you choose a new master password and enter your account details again. This can't be undone.

## Check it yourself

You can confirm that the numbers are stored only as ciphertext. Install the SQLite command-line tool:

```sh
sudo apt install sqlite3
```

Then open the database read-only:

```sh
sqlite3 -readonly ~/.local/share/com.sherlock64.zeni/zeni.db \
  "SELECT name, owner, bank_name, hex(account_number), hex(routing_number) FROM accounts;"
```

The name, owner and bank name appear as text. The account and routing numbers appear as long hexadecimal strings that change every time you set them up and never contain your digits.
