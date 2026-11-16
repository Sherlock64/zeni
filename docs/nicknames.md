# Nicknames

A nickname is a short name you give to a transaction, such as "Coffee" for "STARBUCKS #1234 SEATTLE WA". Zeni shows the nickname in the Transactions list in place of the bank's text. Your imported data never changes; remove a nickname and the bank's text shows again.

A nickname has one or more rules. A rule says which transactions get the nickname.

## Give a transaction a nickname

1. Open **Transactions** and right-click a row. With the keyboard, focus the row and press Shift+F10 or the menu key.
2. Choose **Rename it**.
3. Type the nickname and click **Save**.

Zeni starts with a rule that matches this transaction's description exactly. Under the fields it shows how many transactions the rule matches, for example "Matches 12 transactions". The count updates as you change the rule.

If you type the name of an existing nickname, Zeni says "Adds this rule to <name>." and adds the rule to that nickname.

To match more than one description, open **Match options** and change the rule (see [Rules](#rules)).

Hover a nickname in the list to see the bank's description and memo. Search on the Transactions page also matches nicknames.

## Rules

A rule has three parts.

- **Match**
  - **Exact**: the whole text equals the pattern, ignoring case and spaces at the ends.
  - **Contains**: the text includes the pattern anywhere, ignoring case.
  - **Regex**: the text matches a regular expression, ignoring case. Start the pattern with `(?-i)` to match case. Zeni shows the error, with its position, when the expression is not valid.
- **Field**: **Description** or **Memo**. A transaction with no memo never matches a memo rule.
- **Pattern**: 1 to 500 characters.

Names are 1 to 100 characters. Names are unique, ignoring case.

### When several rules match

One rule wins per transaction:

1. **Exact** beats **Contains**, which beats **Regex**.
2. Within a match type, the longer pattern wins.
3. If the length ties, the older rule wins.

Rules of a nickname that is turned off are ignored. A rule that matches nothing is still saved.

## The Nicknames page

Open **Nicknames** in the sidebar. For each nickname the table shows its rules, how many transactions each rule won, the newest transaction it matched ("Never matched" if none), and the controls below.

- **On/off switch**: turn a nickname off to show bank text again without deleting it.
- **Don't flag as stale**: see [Stale nicknames](#stale-nicknames).
- **Add nickname**, rename a nickname, add, edit or delete a rule.
- **Delete nickname**: deletes its rules. Its transactions show their bank text again.

A nickname always keeps at least one rule; delete the nickname instead.

Zeni updates the list at once after every change. It also applies your rules to new transactions when you import a file. Reverting an import removes its transactions from the counts.

## Stale nicknames

A nickname is stale when its newest matched transaction is more than a set number of days before the newest transaction in Zeni, or when it has never matched. Stale nicknames get a **Stale** badge. Use **Show only stale** to list them. A turned-off nickname has no matches, so it counts as stale unless you tick **Don't flag as stale**.

Set the number of days in **Settings > Nicknames**, **Flag nicknames as stale after (days)**: 1 to 3650, default 90.
