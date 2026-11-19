# Install and update Zeni

Zeni ships as a `.deb` package for Ubuntu 24.04 and Pop!_OS 24.04 on amd64. Zeni is free. The code is in a public repository and the builds run on free GitHub-hosted runners.

## Install

1. Open the [Zeni releases page](https://github.com/Sherlock64/zeni/releases).
2. Download the `.deb` of the newest release. It is named `Zeni_<version>_amd64.deb`, for example `Zeni_7.0.0_amd64.deb`.
3. Install it from the folder you downloaded it to:

```sh
sudo apt install ./Zeni_7.0.0_amd64.deb
```

4. Open **Zeni** from your application menu.

The package recommends `gnome-keyring`, which keeps Zeni unlocked between starts. Without a keyring Zeni still works but asks for your master password at every start. First run: [security.md](security.md).

## Update

1. When a newer version is out, Zeni shows a banner "Zeni <version> is available". Click **Download** to open its release page. You can also open **Settings > About** and click **Check now**.
2. Download the new `.deb` and install it over the old one with the same `sudo apt install ./<file>.deb` command.
3. Open Zeni. Zeni never installs updates by itself.

Before it migrates your data to a newer version, Zeni writes a "Before update" backup to your backup folder. Zeni never deletes these backups. If the backup fails, Zeni stops and shows **Backup before update failed**. Click **Retry**, or **Continue without backup** and confirm.

After an update, the **What's new in Zeni** dialog lists the changes once. To read it again, click **Release notes** in **Settings > About**.

If you open data from a newer Zeni, Zeni shows **Data from a newer Zeni** and changes nothing. Install the newer version, or [restore a backup by hand](#restore-a-backup-by-hand).

### Update check

The update check is on by default. Once a day Zeni asks GitHub for the latest release of Zeni. The request carries only the Zeni version in its user agent and sends no personal data. It is the only call Zeni makes outside your machine.

To turn it off, switch off **Check for updates daily** in **Settings > About**. Zeni then sends nothing. **Check now** still makes one request when you click it. **Dismiss** on the banner hides it for that version until the next daily check.

## Uninstall

```sh
sudo apt remove zeni
sudo apt purge zeni
```

Neither command deletes your data. `purge` prints where the data is and how to delete it:

```
Zeni left your data in ~/.local/share/com.sherlock64.zeni. To delete it, run: rm -rf ~/.local/share/com.sherlock64.zeni
```

## Where the data lives

- Release build: `~/.local/share/com.sherlock64.zeni/zeni.db`.
- Dev build (`pnpm tauri dev`): `~/.local/share/com.sherlock64.zeni/dev/zeni.db`. It never touches the release data.
- Backups: `~/.local/share/com.sherlock64.zeni/backups` unless you chose another folder ([backup.md](backup.md)).

## Restore a backup by hand

Use this when Zeni shows **Data from a newer Zeni** and you want to go back to an older version. Settings is not reachable on that screen, so restore the file yourself. Keep the older Zeni installed.

1. Quit Zeni.
2. Open the backup folder: `~/.local/share/com.sherlock64.zeni/backups` unless you chose another folder in **Settings > Backups**. A dev build uses `~/.local/share/com.sherlock64.zeni/dev/backups`.
3. Pick the newest `zeni-YYYYMMDD-HHMMSS-pre-update.db`. Zeni wrote it just before the newer version changed your data. If a newer-version backup is missing, use the newest backup of another kind taken before the update.
4. Move the current data aside. Never delete it:

```sh
cd ~/.local/share/com.sherlock64.zeni
mkdir aside
mv -n zeni.db aside/
mv -n zeni.db-wal zeni.db-shm aside/   # only if these files exist
```

5. Copy the backup in as `zeni.db` and make it private. With a custom backup folder, use the full path of the file there instead of `backups/...`:

```sh
cp backups/zeni-YYYYMMDD-HHMMSS-pre-update.db zeni.db
chmod 600 zeni.db
```

6. Start the older Zeni. If it shows **Data from a newer Zeni** again, the backup is also from the newer version; pick an earlier one and repeat step 5 only. Never repeat step 4: `aside/` already holds your newer data.

Changes made after that backup are not in it. They stay in `aside/zeni.db`. To undo, quit Zeni first, then move the files back. Run these only with Zeni closed:

```sh
cd ~/.local/share/com.sherlock64.zeni
mkdir restored
mv -n zeni.db restored/
mv -n zeni.db-wal zeni.db-shm restored/   # only if these files exist
mv -n aside/zeni.db .
mv -n aside/zeni.db-wal aside/zeni.db-shm .   # only if these files are in aside/
```

The first three commands keep the restored copy in `restored/`; never delete it. Afterwards, check that `aside/` is empty. A file left there means a move was skipped.

## Require the CI check on `main` (repository owner)

The `CI` workflow runs on every pull request to `main` and every push to `main`. To block merges that fail it:

1. In GitHub, open the repository **Settings > Rules > Rulesets** (or **Settings > Branches** for a branch protection rule).
2. Add a rule that targets `main`.
3. Turn on **Require status checks to pass** and add the `CI` check. If it is not listed, open a pull request first so it has run once.
4. Save.

## Releases (maintainers)

Pushing a tag `v<major>.<minor>.<patch>` starts the `Release` workflow. It fails and publishes nothing when the tag differs from the version in `src-tauri/Cargo.toml`, or when `CHANGELOG.md` has no `## <version>` section. Tags that are not `v<major>.<minor>.<patch>` release nothing. The release notes are that `CHANGELOG.md` section.
