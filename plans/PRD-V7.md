# Personal Finance App — V7 PRD: CI/CD, Installer and Updates

V7 is about how Zeni gets built and delivered. Every PR and every push to `main` runs the check gate and builds the `.deb` on GitHub Actions. Pushing a version tag publishes the `.deb` to a GitHub Release, with notes from `CHANGELOG.md`. The package gets a real app icon, a launcher entry and declared dependencies. Once a day the app checks for a newer release and shows a banner with a download link. Before it migrates data on a new version, it takes a backup, and after an update it shows that version's release notes. A new `devops` agent owns the pipeline. Builds on PRD-V1.md to PRD-V6.1.md; see ROADMAP.md.

**App version**: the version being built, in full semver: V7 is `7.0.0`, a later `v7.0.1-…` hotfix is `7.0.1`. Versions compare numerically, part by part: `7.10.0` > `7.9.0` > `7.0.1` > `7.0.0`.

**Last run version**: the app version that last opened the database, stored in `app_meta`. A database without one (made by V6 or earlier) counts as older than every version.

## User Stories

### S1: Checks on every PR
As a user, I want every PR checked on GitHub, so that nothing red reaches `main`.

- **S1-T1** (devops; deps: none): a `CI` workflow on `ubuntu-24.04` for pull requests to `main` and pushes to `main`. It runs `scripts/check.sh integration` with `ZENI_DEPS_APPROVED=1` and `ZENI_SUPPRESSIONS_APPROVED=1`, because the user approves dependencies and suppressions locally, and on pull requests it also builds the `.deb`.
  - A PR fails the run when it has a fmt or clippy error, a failing Rust or TS test, a `tsc` error, stale ts-rs bindings, an edited applied migration, or a `.deb` that won't build (RUNTIME, on GitHub).
  - A PR that adds a dependency or a suppression doesn't fail the run on that alone (RUNTIME).
  - A new push to a PR cancels that PR's run still in progress (RUNTIME).
  - The run needs no secrets beyond the default `GITHUB_TOKEN`, with read-only permissions.

### S2: A proper Pop!_OS package
As a user, I want Zeni to install like any other app, so that it has an icon, shows in the launcher and pulls in what it needs.

- **S2-T1** (backend; deps: none): app version `7.0.0` everywhere the build reads a version, the new app icon, a desktop entry, package dependencies, and a purge message.
  - The icon is a flat-top hexagon with a dark `#0a0a0a` fill, a green `#10b981` outline and a green Z, as in `plans/assets/V7/zeni-icon.svg`. That SVG goes in the repo as the icon source, and every PNG size the bundle uses is generated from it with `pnpm tauri icon`. The window, the launcher and the `.deb` all show it.
  - Two backup icon SVGs from `plans/assets/V7/` sit next to the source unused: `zeni-icon-alt-black-z.svg` (green hexagon, black Z) and `zeni-icon-alt-white-z.svg` (green hexagon, white Z).
  - `dpkg-deb -I` on the built `.deb` shows `Version: 7.0.0`, a `Depends` that includes `libwebkit2gtk-4.1-0`, and `Recommends: gnome-keyring`.
  - The installed desktop entry has `Categories=Office;Finance;`, and Zeni shows in the COSMIC launcher with the new icon (RUNTIME).
  - `apt remove zeni` and `apt purge zeni` leave `~/.local/share/com.sherlock64.zeni` untouched. Purge prints that the data is still in that folder and how to delete it by hand (RUNTIME).
  - `app_info` returns `7.0.0`.

### S3: Release pipeline
As a user, I want a version tag to publish an installable release, so that updating is downloading one file.

- **S3-T1** (devops; deps: S1-T1, S2-T1): a `Release` workflow on `ubuntu-24.04` that runs when a tag matching `v<major>.<minor>.<patch>` is pushed. It builds the `.deb` and publishes a GitHub Release named `Zeni <version>`, with the `.deb` attached and that version's `CHANGELOG.md` section as its notes.
  - Tag `v7.0.0` with app version `7.0.0` publishes the release (RUNTIME).
  - Tag `v7.0.1` with app version `7.0.0` fails, naming both versions, and publishes nothing.
  - A tag with no `## 7.0.1` section in `CHANGELOG.md` fails and publishes nothing.
  - A tag that isn't three numbers (for example `v7`, `v7.1`, `v7.0.0-rc1`) starts no release.
- **CHANGELOG format**: one `## <version>` heading per version, newest first, each followed by a plain `- ` bullet list. Example: `## 7.0.0` then `- Zeni now tells you when an update is out.`

### S4: Update notice
As a user, I want to hear when a newer Zeni is out, so that I can update without watching GitHub.

- **S4-T1** (backend; deps: none): the update check, an `update_checks` setting (default on), the last check result, a check-now command and a dismiss command.
  - At launch, when checks are on and none ran on today's local date, Zeni sends one `GET https://api.github.com/repos/Sherlock64/zeni/releases/latest` with user agent `Zeni/<version>` and nothing else from the user. With checks off, launch makes no request.
  - Check now always makes one request, whether the setting is on or off.
  - The release's `tag_name` with its leading `v` removed is compared with the app version. Examples: `v7.1.0` against `7.0.0` → newer `7.1.0`; `v7.0.0` against `7.0.0` → up to date; `v6.1.0` against `7.0.0` → up to date; `v7.10.0` against `7.9.0` → newer.
  - A newer result returns the version and the release page URL. Any URL not under `https://github.com/Sherlock64/zeni/releases/` is rejected, and the check counts as failed.
  - A network error, a non-200 status, a tag that isn't `v<major>.<minor>.<patch>` or a bad body is stored as `failed` with the date and a one-line reason. Every other command keeps working.
  - Dismiss hides the banner for that version until the next day's check.
  - The last result (up to date, newer with version, or failed with reason) and its date survive restarts.
- **S4-T2** (UI; deps: S4-T1): a banner across the app, "Zeni 7.1.0 is available", with Download and Dismiss, and a Settings > About card. Download opens the release page in the default browser through `tauri-plugin-opener` (approved dependency: Cargo crate and npm package). The About card shows the installed version, an "Check for updates daily" switch, the last check's result and date, Check now, and Release notes (S6-T2).
  - The banner shows only for a newer, undismissed result, and never on the setup or unlock screens.
  - Check now shows a spinner while it runs, then the new result; a failure shows its reason.
  - The switch's hint says the check contacts GitHub once a day and sends no personal data.

### S5: Backup before update
As a user, I want a backup before a new version changes my data, so that I can always go back.

- **S5-T1** (backend; deps: none): at startup, before any migration, Zeni compares the last run version with the app version, takes a `pre-update` backup when the data is older, migrates, then stores the app version as the last run version.
  - Older data (a V6 database, or last run version `7.0.0` on app `7.1.0`) gets one backup named `zeni-YYYYMMDD-HHMMSS-pre-update.db` before migrations run. The next launch on the same version takes none.
  - A fresh install (no database file) and the same version take no backup.
  - `pre-update` backups are never pruned, are listed with the others and can be restored.
  - If the backup fails, nothing migrates, and the status says the backup failed and why. Retry tries again. Continue without backup, which needs a confirm flag, migrates without one.
  - Newer data (last run version `7.1.0` on app `7.0.0`, or an applied migration this app doesn't have) opens nothing and changes nothing. The status names the newer version when it is known.
- **S5-T2** (UI; deps: S5-T1): a startup screen for each state. "Backup before update failed" shows the reason with Retry and Continue without backup, the latter behind a confirm dialog that says the data will be updated with no copy. "Data from a newer Zeni" says: install Zeni <version> or newer, or restore a backup taken before it, with a link to `docs/install.md`. In the Backups list the new kind shows as "Before update".

### S6: Release notes in the app
As a user, I want to see what changed after an update, so that I find new features.

- **S6-T1** (backend; deps: S5-T1): `CHANGELOG.md` built into the app. One command returns its sections, newest first, and another acknowledges them. An upgrade marks notes as pending.
  - After an upgrade from `7.0.0` to `7.2.0`, the pending notes are the `7.2.0` and `7.1.0` sections. From a V6 database they are only the `7.0.0` section. A fresh install has none pending.
  - Acknowledging clears pending, and it stays cleared across restarts.
  - The command for all notes returns every section, newest first.
- **S6-T2** (UI; deps: S6-T1): after the first unlock with notes pending, a dialog "What's new in Zeni" shows those sections. Closing it acknowledges them. Release notes in Settings > About opens the same dialog with every section. A line starting `- ` shows as a list item, and any other non-empty line as a paragraph.

### S7: Delivery workflow
As a user, I want the agents to own the pipeline and the release steps, so that releases happen the same way every time.

- **S7-T1** (agents; deps: S1-T1): a `devops` agent that owns `.github/workflows/**` and fixes pipeline failures, added to the dev contract's ownership table.
  - `build-version`: after opening the PR, the organizer waits for CI. Each failing job becomes a fix task for the owner of the cited file (pipeline files go to `devops`), handled like a blocking council finding, until CI is green.
  - `build-version` and `fix-bug` set the app version for their branch and add its `CHANGELOG.md` section.
  - After the PR merges, the organizer asks the user once, then pushes the tag `v<major>.<minor>.<patch>`.
- **S7-T2** (docs; deps: S1-T1 to S6-T2): `docs/install.md` covers install, update, uninstall, the data location and turning on required status checks for `main` in GitHub. `CHANGELOG.md` gets its `7.0.0` section. `CLAUDE.md` says the update check is the only call outside the machine and Ollama on `127.0.0.1` the only other network call.

## Decisions

- Every roadmap V7 item stays in V7. CI and releases run on `ubuntu-24.04`, not 22.04.
- The app version equals the version being built, and the release tag must match it.
- Release notes come from `CHANGELOG.md`, used both by the release and built into the app, so they work offline.
- CI sets the dependency and suppression overrides, because the user approves those locally. Every other gate still fails CI.
- The update check is on by default. The banner has Download and Dismiss, About has Check now, and Download uses `tauri-plugin-opener`.
- A failed pre-update backup stops the migration. Retry, or a confirmed Continue without backup, moves on.
- `pre-update` backups are never pruned.
- Downgraded data gets a clear message, and nothing opens or changes.
- Release notes show in a dialog once after the update, and again from About.
- The `.deb` Recommends `gnome-keyring` instead of depending on it, because the master password covers a missing keyring.
- The icon is a green Z in a dark, green-outlined flat-top hexagon. The two other designs stay in the repo as unused backups.
- The organizer pushes the release tag after asking; the user turns on branch protection.
- New agent owners in this PRD: `devops` (pipeline), `agents` (`prompt-engineer`), `docs` (`docs-writer`).

## New Terms

- **App version**: the semver version Zeni is built as; it equals the release tag without the `v`.
- **Last run version**: the app version that last opened the database (`app_meta`).
- **Pre-update backup**: a backup of kind `pre-update` ("Before update"), taken before a newer version migrates the data; never pruned.
- **Update check**: the daily request to GitHub Releases for the latest Zeni version.
- **Release notes**: a version's section of `CHANGELOG.md`, shown on its GitHub Release and in the app.

## Out of Scope

- Installing updates automatically, an apt repository, package signing.
- Flatpak, AppImage, other distributions, Ubuntu 22.04.
- Pre-release or draft releases, and skipping a version permanently.
