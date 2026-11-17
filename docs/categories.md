# Categories

Zeni groups transactions by category, such as "Groceries" or "Paycheck". You can set a category yourself, give a nickname a default category, or let a model on your own computer pick one. Your imported data never changes.

## Categories and kinds

Open **Categories** in the sidebar. A new database starts with 22 categories. Each has a name, a description and a kind.

- **Name**: 1 to 40 characters, unique ignoring case.
- **Description**: 0 to 200 characters. A good description helps the model choose.
- **Kind**: **Spending**, **Income** or **Transfer**. The kind decides how a category counts in [spending totals](#spending-rules).

To add a category, fill the form and save. To edit one, change it and save. To reorder, drag a handle, or focus it and press Space, then use the arrow keys. A kind change applies at once.

To delete a category, use its delete button. If transactions or nicknames use it, Zeni shows how many and asks where to move them. Choose **Leave uncategorized** to clear them instead. Moved rows keep who set them. With no replacement, a row you set yourself to the deleted category falls back to its nickname's default category, if it has one; otherwise it becomes uncategorized.

While a categorize run is going, every edit control on the page is disabled with "Wait for categorizing to finish".

## Set a category or note yourself

1. Open **Transactions** and right-click a row, or click its **Category** cell. With the keyboard, focus the row and press Shift+F10 or the menu key.
2. Choose **Categorize…**.
3. Pick a category, add a note of up to 500 characters, and click **Save**.

The row shows the category with a marker for who set it: **You**, **Nickname** or **Model**. A dot on a model row means you have not reviewed it. A note icon shows the note on hover. Search also matches notes.

Pick **Uncategorized** to clear your category. The note stays, and the row is open to the model again.

Use the category filter on Transactions to show one category or **Uncategorized**.

## Connect Ollama

Zeni uses [Ollama](https://ollama.com) to categorize. Install it and start it with `ollama serve`. Zeni talks only to Ollama on this computer (`127.0.0.1`). It has no host setting, ignores any system HTTP proxy setting, and makes no other network call.

Open **Settings** and find the **Ollama** card.

- **Port**: the port Ollama listens on. The default is 11434. Enter 1 to 65535.
- **Status**: shows whether Ollama is running and its version. When it is not reachable, the card says so and every other part of Zeni keeps working.
- **Base model**: the installed model that categorizes. Pick one from the list. If none is installed, the card shows an `ollama pull <model>` command you can copy.
- **Recommended models**: pick one that is not installed and confirm "Download <model> (<size>)?". A progress bar with **Cancel** shows the download, and it comes back if you leave and reopen Settings. A finished download becomes your base model.

| Model | Download | What to expect on the sample files |
|---|---|---|
| `phi4-mini` | about 2.5 GB | Best pick: 51 of 52 rows right, about 0.4 s a row. |
| `qwen2.5:3b` | about 1.9 GB | Smallest download: 46 of 52 right, about 0.4 s a row. |
| `gemma3:4b` | about 3.4 GB | Slower alternative: 44 of 52 right, about 1.8 s a row. |

Picking a base model switches off the active [model build](#model-builds).

Only one Ollama job runs at a time: a categorize run, a download or a build. Starting another says which one is running.

## Categorize now and Recategorize all

Both buttons are on **Transactions**.

- **Categorize now**: categorizes rows that have no category.
- **Recategorize all**: asks to confirm, then categorizes every row you did not set yourself and no nickname sets. Rows set by you or by a nickname stay as they are.

The buttons are disabled, with the reason, when Ollama is not running, no model is picked, or a job is running.

A banner shows "Categorizing <done> of <total>" with **Cancel**. It stays when you change pages. Cancel keeps the finished rows and leaves the rest alone. When the run ends the banner shows "Categorized <a>. Couldn't categorize <b>. Not reached <c>." Click **Dismiss** to clear it.

Zeni sends the model one row at a time, with the nickname, description, memo, amount and the CSV bank category when there is one, plus your category list. An answer not on the list is retried once. If it is still wrong, the row stays uncategorized and counts as "couldn't categorize". If Ollama stops answering, the run stops and the summary says after how many rows.

Model answers are marked **Model** and unreviewed.

## Auto-categorize after import

In the **Ollama** card, **Categorize new rows after each import** is on by default. After an import adds rows, Zeni categorizes the new uncategorized ones in the background.

If it cannot start, the import still commits and the import summary adds a line such as "Imported. Categorizing didn't start: Ollama isn't running."

## Review

Open **Review** in the sidebar. A badge shows how many model answers you have not reviewed. Rows are grouped by category in category order, and each group collapses.

- Change a row's category: it becomes set by you and reviewed, and leaves the group.
- **Looks good**: marks the rest of the group reviewed.

## Nickname default categories

A [nickname](nicknames.md) can have a default category. Set it on the **Nicknames** page or in the Rename dialog.

Rows the nickname matches show that category, marked **Nickname**, count as reviewed, and are never sent to the model. They follow changes: a new default, new matches or a changed rule apply at once. Removing the default, disabling the nickname or deleting it leaves those rows uncategorized, ready for the model. A category you set yourself always wins.

Deleting a category without a replacement clears the defaults that used it.

## Model builds

A build teaches the model from your rows. In the **Ollama** card, under **Model builds**:

- **Build**: makes an Ollama model named `zeni-<number>` from the base model, your category list and examples. Examples come from rows set by you, set by a nickname, or set by the model and reviewed. A build takes up to N per category, newest first, using distinct nicknames or descriptions before repeats. Set N in **Examples per category** (1 to 20, default 5). A build needs at least one example.
- **Built model contents**: a built model holds the example rows it was trained on. Deleting a build in Zeni also removes its model from Ollama.
- **Make active**: categorizing uses the active build. With none, it uses the base model.
- **Delete**: asks to confirm, then removes the build from Ollama and the list. Deleting the active build falls back to the base model.
- **Out of date**: any change to the category list marks every build out of date. It stays active, and the button reads **Rebuild**.

## Spending rules

The backend has one shared spending query for dashboards in a later version; no page shows it yet. It works on each row's effective category: yours, else the nickname's default, else the model's.

- Spending is minus the sum of amounts in **Spending** categories. A refund reduces it: -$50.00 and +$10.00 in Groceries is $40.00 spent.
- Income is the sum of amounts in **Income** categories.
- Rows in **Transfer** categories count in neither.
- Uncategorized rows are reported on their own, with a count and a total.
