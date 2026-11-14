# Importing bank files

Zeni imports OFX and QFX files. Transactions go into your checking account.

## Import a file

1. Download an OFX or QFX file from your bank's website.
2. Open **Transactions** and click **Import file**.
3. Pick the file.

Zeni shows a summary: how many transactions it added, how many duplicates it skipped, and the result of the balance check.

Zeni rejects a file, and stores nothing, when:

- it does not end in `.ofx` or `.qfx`,
- it is larger than 10 MiB,
- it holds no bank statement, or more than one,
- its currency is not US dollars,
- a required value, such as a date or amount, is missing or not valid.

## Duplicates

You can import overlapping date ranges. Zeni skips transactions it already has:

- A transaction with a bank ID (`FITID`) is a duplicate if an earlier import, or an earlier row in the same file, has the same ID.
- A transaction without a bank ID is a duplicate if an earlier import has one with the same date, amount and description. Two identical rows in the same file are both kept, since they are usually two real purchases.

A file whose transactions are all duplicates is still recorded in the import history.

## Balance check

Most bank files include the account balance on a given date. Zeni compares it with what it expects: the balance from your most recent earlier import dated on or before this file's balance date, plus every transaction posted between the two dates. Importing the same file again therefore passes, and a different file with the same date but a different balance doesn't match.

| Result | Meaning |
|---|---|
| **Balance check passed** | The bank's balance matches what Zeni expected. |
| **Balance doesn't match** | The bank's balance differs from what Zeni expected. Transactions are probably missing, for example from a gap between two downloads. Zeni still imports the file. |
| **First balance recorded** | No earlier import has a balance to compare with. Later imports are checked against this one. |
| **Balance not checked** | The file has no balance. |

## Import history and reverting

Click **Import history** on the Transactions page to see every import, newest first, with its row count and balance check result.

To undo an import, click **Revert** next to it and confirm. Zeni permanently deletes that import and every transaction it added. This cannot be undone, but you can import the same file again. Other imports keep the balance check result they had when you imported them.
