# Backing up and restoring Zeni

Zeni copies its database to backup files. You can restore any of them to replace your current data. Manage backups in Settings > Backups.

Backup files are not encrypted. Keep them somewhere private: [what is in a backup](security.md#backups).

## Where backups go

By default Zeni writes backups to `~/.local/share/com.sherlock64.zeni/backups`, a folder only you can open. Settings shows the folder in use and marks the default one **(default)**.

To use another folder, such as a USB drive or a synced folder, click **Change folder…** and pick an existing folder. Zeni first checks that it can write there and refuses the folder if it can't. Backups already in the old folder stay there and no longer appear in the list.

## File names and kinds

Each backup is one file named `zeni-YYYYMMDD-HHMMSS-<kind>.db`, stamped with your local date and time, for example `zeni-20261115-140322-daily.db`. Only you can read it (mode 0600).

| Kind in the file name | Shown as | Made when |
|---|---|---|
| `manual` | Manual | You click **Back up now**. |
| `daily` | Daily | Zeni starts for the first time on a day. |
| `pre-revert` | Before revert | You revert an import, just before Zeni deletes it. |
| `safety` | Safety copy | You restore a backup, just before Zeni replaces your data. |

Zeni lists only files in the backup folder that follow this naming pattern. It ignores other files there.

## Automatic backups

- **Daily:** the first time Zeni starts on a given day, it writes a daily backup, even before you unlock. Later starts that day write nothing.
- **Before revert:** reverting an import writes a backup first. If that backup fails, Zeni reverts nothing and shows why. To get a reverted import back, restore its before-revert backup.

## How many backups Zeni keeps

Daily and before-revert backups are automatic. Zeni keeps the newest 14 of them together and deletes older ones. Manual backups and safety copies are never deleted; remove them yourself when you no longer need them.

To change the number, enter a value from 1 to 365 in **Automatic backups to keep** and click **Save**. Zeni deletes extra automatic backups right away.

## Back up now

Click **Back up now**. Zeni shows the path of the new file. You can back up at any time, including during an import.

## Restore a backup

Restoring replaces all your current data with the backup. Zeni must be unlocked.

1. In Settings > Backups, under **Restore**, click **Restore** next to a backup. To restore a file from somewhere else, click **Restore from file…** and pick it.
2. Read the confirmation and click **Replace my data**.

Zeni then:

1. Checks the file. It refuses a damaged file, a file that isn't a Zeni backup, and a backup from a newer version of Zeni. Nothing changes.
2. Writes a safety copy of your current data to the backup folder. If it can't, Zeni restores nothing.
3. Replaces your data with the backup. A backup from an older version of Zeni is updated to the current version. If the restored data won't open, Zeni puts your previous data back from the safety copy.
4. Locks and reads its security status again. If your keyring still holds the key the backup uses, Zeni opens on the restored data without asking for anything.

A safety copy is a backup like any other. You can restore it later from the list.

## Undo restore

If Zeni shows the unlock screen after a restore, it also offers **Undo restore**. It puts back the data you had before the restore, from the safety copy. The safety copy stays in the backup folder.

Undo restore is available only until you close Zeni or restore again. If Zeni opened straight onto the restored data, or the button is gone, restore the safety copy from the list instead.

## Restoring a backup made before a security reset

A backup keeps the master password and recovery codes that were in use when it was made. If you erased and set up Zeni again after that backup ([Erase and set up again](security.md#if-you-lose-everything-erase-and-set-up-again)), your keyring doesn't hold the backup's key. After the restore, Zeni shows the unlock screen.

- Enter the master password you had when the backup was made, or one of the recovery codes you had then. Your current password doesn't work on that data.
- Once unlocked, Zeni saves the backup's key in your keyring, so the next start skips the prompt.
- If you don't have that password or a code, click **Undo restore** to return to your current data.

## If the backup folder is missing or can't be written

This happens, for example, when the folder is on a USB drive that isn't plugged in.

- **Back up now** shows an error. Plug in the drive or choose another folder, then try again.
- **Daily backup:** Settings > Backups shows "Today's automatic backup didn't work" with the reason. Zeni keeps working and tries again the next time it starts. You can also click **Back up now**.
- **Revert** and **restore** stop and change nothing, because they need their backup or safety copy first.
- The list of backups shows an error with **Try again**.
