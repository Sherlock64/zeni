# Importing bank files

Zeni imports OFX, QFX and CSV files. Transactions go into your checking account, so add it first; without it Zeni rejects every file.

## Import a file

1. Download an OFX, QFX or CSV file from your bank's website.
2. Open **Transactions** and click **Import file**.
3. Pick the file.
4. For a CSV file Zeni hasn't seen before, map its columns (see [CSV files](#csv-files)).
5. If Zeni finds possible duplicates, answer each one (see [Possible duplicates from another format](#possible-duplicates-from-another-format)).

Zeni shows a summary: how many transactions it added and how many duplicates it skipped, the result of the balance check, and, when they apply, how many rows were not posted, how many you skipped in review, and the result of the running-balance check.

Zeni rejects a file, and stores nothing, when:

- it does not end in `.ofx`, `.qfx` or `.csv`,
- it is larger than 10 MiB,
- an OFX or QFX file holds no bank statement, or more than one,
- an OFX or QFX file's currency is not US dollars,
- a CSV file has no header row, or a row has a different number of columns than the header,
- a required value, such as a date or amount, is missing or not valid.

For a CSV file the error names the line, for example "Line 7: Amount 0.00500 isn't a whole number of cents." When the file was read with a saved layout, the error adds "If the saved layout is wrong, edit it in Settings > CSV layouts."

## CSV files

A CSV file must start with a header row and use commas between columns. Values may be in double quotes.

### Map the columns

The first time you import a CSV file with a given header, Zeni asks which column holds what. It picks likely columns from the header names; check them and change any that are wrong.

Required:

- **Posted date** and its **Date format**.
- **Description**.
- **Amount**: either **One signed column** (negative for money out) or **Debit and credit columns**.

Optional: **Transaction ID**, **Memo**, **Transaction type**, **Running balance**, **Posting status** and **Bank category**. Each column can hold only one role.

The preview shows the first rows as Zeni reads them with your mapping, and the first problem on each row. Enter a **Layout name**, for example your bank's name, and click **Save and import**. Zeni saves the mapping as a layout and imports the file. If the file is rejected, nothing is saved; fix the mapping or click **Cancel**. Clicking outside the dialog doesn't close it.

The next file with the same header imports straight away with the saved layout. Header names match regardless of case and extra spaces.

### Dates

| Format | Example | Notes |
|---|---|---|
| `MM/DD/YYYY` | `10/03/2026` | Month and day need two digits. |
| `M/D/YYYY` | `10/3/2026` | One or two digits for month and day. |
| `YYYY-MM-DD` | `2026-10-03` | |
| `DD/MM/YYYY` | `03/10/2026` | Day and month need two digits. |

The date must exist: `02/29/2027` rejects the file.

### Amounts

- An amount may start with `-`, `$`, `-$` or `$-`, and may have up to 5 decimal places.
- It must be a whole number of cents: `-18.40000` and `$12.5` are fine; `12.345` and `0.00500` reject the file.
- Thousands separators are not allowed: `1,200.00` rejects the file.
- With debit and credit columns, Zeni ignores the sign: the debit is money out, the credit money in. An empty cell counts as zero; a row with both empty rejects the file.

### Posting status

When you map a **Posting status** column, Zeni imports only rows whose status is `Posted` (any case). It skips every other row, including pending ones and rows with an empty status, and counts them as "not posted" in the summary. Zeni doesn't check skipped rows' dates or amounts.

### Saved layouts

Open **Settings** to see your saved layouts under **CSV layouts**.

- Click **Edit** to rename a layout or change its mapping. Changes apply to the next file you import with that header.
- Click **Delete** and confirm to forget a layout. The next file with that header asks you to map its columns again.

Editing or deleting a layout never changes transactions you already imported.

If the same header means something different in another file, the saved layout is still used. Edit it in Settings first.

## Duplicates

You can import overlapping date ranges. Zeni skips transactions it already has:

- A transaction with a bank ID is a duplicate if an earlier import, or an earlier row in the same file, has the same ID. For OFX and QFX the ID is the `FITID`; for CSV it is the column mapped as **Transaction ID**.
- A transaction without a bank ID is a duplicate if an earlier import has one with the same date, amount and description. Two identical rows in the same file are both kept, since they are usually two real purchases.

A file whose transactions are all duplicates is still recorded in the import history.

If your bank changes its transaction IDs between downloads, re-imported rows are not recognised. Revert the import, edit the layout in Settings so **Transaction ID** is **Not mapped**, and import again.

## Possible duplicates from another format

The same transaction in a CSV file and in an OFX or QFX file can have different IDs and descriptions. Before it stores anything, Zeni compares each new row with rows from your imports in the other format (CSV against OFX or QFX, either way round). A row is a possible duplicate when the amount is exactly the same and the dates are at most 2 days apart.

When Zeni finds any, it opens **Check possible duplicates** with each pair: the row from this file and the row already imported. For each pair choose:

- **Yes, duplicate (skip it)**: Zeni doesn't import the row. The summary counts it as skipped in review.
- **No (import it)**: Zeni imports the row.

Answer every pair, then click **Confirm and import** to store the file. Click **Cancel** to store nothing. Clicking outside the dialog doesn't close it.

When there are no possible duplicates, the file imports straight away.

When you cancel the mapping or the review, Zeni shows "Nothing was stored."

## Balance check

Most bank files include the account balance on a given date. For a CSV file with a **Running balance** column, that is the balance on the newest posted row. Zeni compares it with what it expects: the balance from your most recent earlier import dated on or before this file's balance date, plus every transaction posted between the two dates. Importing the same file again therefore passes, and a different file with the same date but a different balance doesn't match.

| Result | Meaning |
|---|---|
| **Balance check passed** | The bank's balance matches what Zeni expected. |
| **Balance doesn't match** | The bank's balance differs from what Zeni expected. Transactions are probably missing, for example from a gap between two downloads. Zeni still imports the file. |
| **First balance recorded** | No earlier import has a balance to compare with. Later imports are checked against this one. |
| **Balance not checked** | The file has no balance. |

## Running-balance check

For a CSV file with a **Running balance** column, Zeni also checks the file itself: each posted row's balance must equal the previous posted row's balance plus its amount. Zeni works out from the dates whether the file lists the newest or the oldest row first. It runs this check before skipping duplicates.

| Result | Meaning |
|---|---|
| **Running balance check passed** | Every posted row's balance adds up. |
| **Running balances don't add up** | A row's balance doesn't equal the previous balance plus its amount, or a posted row has no balance. Rows may be missing or changed. Zeni still imports the file and flags it in the import history. |

The summary shows no running-balance result when no balance column is mapped or no row is posted.

## Import history and reverting

Click **Import history** on the Transactions page to see every import, newest first, with its row count and balance check results.

To undo an import, click **Revert** next to it and confirm. Zeni permanently deletes that import and every transaction it added. This cannot be undone, but you can import the same file again. Other imports keep the balance check result they had when you imported them.
