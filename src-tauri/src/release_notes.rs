//! Release notes from the built-in `CHANGELOG.md`.

use crate::types::{AppError, AppState, ReleaseNote, ReleaseNotes};
use crate::{db, version};

const CHANGELOG: &str = include_str!("../../CHANGELOG.md");

pub async fn notes(state: &AppState) -> Result<ReleaseNotes, AppError> {
    let (pool, _) = db::current(state)?;
    let since: Option<String> =
        sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'release_notes_since'")
            .fetch_optional(&pool)
            .await?;
    Ok(build(CHANGELOG, since.as_deref(), version::APP_VERSION))
}

/// Clears the pending notes.
pub async fn acknowledge(state: &AppState) -> Result<(), AppError> {
    let (pool, _) = db::current(state)?;
    sqlx::query("DELETE FROM app_meta WHERE key = 'release_notes_since'")
        .execute(&pool)
        .await?;
    Ok(())
}

/// Sections up to `app`, newest first; pending are those after `since` (none when absent).
fn build(changelog: &str, since: Option<&str>, app: &str) -> ReleaseNotes {
    let app = version::parse(app);
    let since = since.and_then(version::parse);
    let mut all = Vec::new();
    // Lines above the first `## ` heading (the `# Changelog` title) belong to no section.
    for line in changelog.lines().map(str::trim) {
        if let Some(heading) = line.strip_prefix("## ") {
            let heading = heading.trim();
            all.push((
                version::parse(heading),
                ReleaseNote {
                    version: heading.into(),
                    lines: Vec::new(),
                },
            ));
        } else if let Some((_, note)) = all.last_mut()
            && !line.is_empty()
        {
            note.lines.push(line.into());
        }
    }
    // A heading that isn't a version (or is newer than the app) is dropped with its lines.
    all.retain(|(v, _)| v.is_some() && *v <= app);
    all.sort_by_key(|(v, _)| std::cmp::Reverse(*v));
    let pending = all
        .iter()
        .filter(|(v, _)| since.is_some_and(|since| *v > Some(since)))
        .map(|(_, note)| note.clone())
        .collect();
    ReleaseNotes {
        pending,
        all: all.into_iter().map(|(_, note)| note).collect(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::types::Database;

    const SAMPLE: &str = "# Changelog\n\
        \n\
        ## 7.2.0\n\
        \n\
        - Charts.\n\
        \x20 - Indented bullet.  \n\
        A plain paragraph.\n\
        \n\
        ## 7.1.0\n\
        - Budgets.\n\
        \n\
        ## 7.0.0\n\
        - Update notice.\n";

    fn versions(notes: &[ReleaseNote]) -> Vec<&str> {
        notes.iter().map(|note| note.version.as_str()).collect()
    }

    #[test]
    fn an_upgrade_from_7_0_0_to_7_2_0_has_two_sections_pending() {
        let notes = build(SAMPLE, Some("7.0.0"), "7.2.0");
        assert_eq!(versions(&notes.pending), ["7.2.0", "7.1.0"]);
        assert_eq!(versions(&notes.all), ["7.2.0", "7.1.0", "7.0.0"]);
        assert_eq!(
            notes.pending[0].lines,
            ["- Charts.", "- Indented bullet.", "A plain paragraph."]
        );
        assert_eq!(notes.pending[1].lines, ["- Budgets."]);
    }

    #[test]
    fn a_v6_database_has_only_the_7_0_0_section_pending() {
        let notes = build(SAMPLE, Some("0.0.0"), "7.0.0");
        assert_eq!(versions(&notes.pending), ["7.0.0"]);
        assert_eq!(versions(&notes.all), ["7.0.0"]);
    }

    #[test]
    fn nothing_is_pending_without_a_since_version() {
        let notes = build(SAMPLE, None, "7.2.0");
        assert!(notes.pending.is_empty());
        assert_eq!(versions(&notes.all), ["7.2.0", "7.1.0", "7.0.0"]);
        assert!(build(SAMPLE, Some("7.2.0"), "7.2.0").pending.is_empty());
    }

    #[test]
    fn all_is_newest_first_and_skips_non_version_headings() {
        let text = "## 7.0.0\n- a\n## Unreleased\n- b\n## 7.10.0\n- c\n## 7.9.0\n- d\n";
        let notes = build(text, None, "7.10.0");
        assert_eq!(versions(&notes.all), ["7.10.0", "7.9.0", "7.0.0"]);
        assert_eq!(notes.all[2].lines, ["- a"]);
    }

    #[test]
    fn the_built_in_changelog_has_this_version() {
        let notes = build(CHANGELOG, Some("0.0.0"), version::APP_VERSION);
        assert_eq!(versions(&notes.pending), [version::APP_VERSION]);
        assert!(!notes.pending[0].lines.is_empty());
    }

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn state_for(dir: &std::path::Path) -> AppState {
        AppState {
            db: std::sync::RwLock::new(run(db::connect(dir))),
            session: Default::default(),
            pending_import: Default::default(),
            backup: Default::default(),
            jobs: Default::default(),
        }
    }

    #[test]
    fn commands_need_an_open_database() {
        let state = AppState {
            db: std::sync::RwLock::new(Err("no database".into())),
            session: Default::default(),
            pending_import: Default::default(),
            backup: Default::default(),
            jobs: Default::default(),
        };
        assert!(matches!(run(notes(&state)), Err(AppError::Database(_))));
        assert!(matches!(
            run(acknowledge(&state)),
            Err(AppError::Database(_))
        ));
    }

    #[test]
    fn acknowledging_clears_pending_across_restarts() {
        let dir = db::temp_dir("release-notes-ack");
        let _ = fs::remove_dir_all(&dir);
        let state = state_for(&dir);
        let (pool, _) = db::current(&state).unwrap();
        run(
            sqlx::query("INSERT INTO app_meta (key, value) VALUES ('release_notes_since', ?)")
                .bind("0.0.0")
                .execute(&pool),
        )
        .unwrap();
        assert_eq!(run(notes(&state)).unwrap().pending.len(), 1);
        run(acknowledge(&state)).unwrap();
        assert!(run(notes(&state)).unwrap().pending.is_empty());
        let Ok(Database { pool, .. }) = state.db.into_inner().unwrap() else {
            panic!("db closed");
        };
        run(pool.close());

        let reopened = state_for(&dir);
        let notes = run(notes(&reopened)).unwrap();
        assert!(notes.pending.is_empty());
        assert_eq!(versions(&notes.all), [version::APP_VERSION]);
        let _ = fs::remove_dir_all(&dir);
    }
}
