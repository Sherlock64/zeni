# Changelog

## 7.2.0

- Ollama job messages are clearer, with a link to Settings and Try again on Transactions.
- Model builds now hold only as many examples as fit Ollama's context window, so categorizing no longer stalls on a large build; a new checkbox in Settings lets builds go past the window for larger Ollama setups.
- Release notes offer Try again when they fail to load.
- Progress bars and the note field now follow the app theme.
- Screen readers hear when a link opens your browser, and the update button now reads "Download Zeni <version>".
- "Select all like this" on Review shows on hover or focus.
- General hardening and test fixes.

## 7.1.0

- Screen readers now hear when an update is available and when release notes load.
- Settings > About offers Try again when the update status fails to load.
- On narrow windows the Transactions description tooltip shows category, balance and type.
- Settings no longer shows the Error handling test card.
- General hardening and test fixes.

## 7.0.0

- Zeni is now a `.deb` package you install from GitHub Releases, with a new green Z icon.
- Zeni tells you when an update is out, with Download and Dismiss on a banner. Settings > About checks on demand and turns the daily check off.
- Zeni backs up your data before a newer version changes it. Those "Before update" backups are never deleted.
- If that backup fails, Zeni stops and lets you retry or continue without it.
- Zeni refuses data from a newer Zeni, changes nothing and says which version to install.
- A "What's new" dialog shows these notes once after an update, and again from Settings > About.
- Removing the package never deletes your data, and purging tells you where it is.
