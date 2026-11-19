//! The daily update check against the latest GitHub release.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use reqwest::header::{ACCEPT, HeaderValue, USER_AGENT};
use serde_json::Value;
use sqlx::SqlitePool;

use crate::db::{meta, set_meta};
use crate::types::{
    AppError, AppState, NewerRelease, SetUpdateChecksRequest, UpdateCheck, UpdateResult,
    UpdateStatus,
};
use crate::{db, version};

const LATEST: &str = "https://api.github.com/repos/Sherlock64/zeni/releases/latest";
const RELEASES_PATH: &str = "/Sherlock64/zeni/releases/";
const ENABLED_KEY: &str = "update_checks";
const LAST_KEY: &str = "update_last";
const DISMISSED_KEY: &str = "update_dismissed";

/// The database path of each check in flight; one entry per check, so overlapping checks count.
static CHECKING: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Marks a check in flight until dropped, even when the check panics.
struct Checking(PathBuf);

impl Checking {
    fn start(path: PathBuf) -> Self {
        checking().push(path.clone());
        Self(path)
    }
}

impl Drop for Checking {
    fn drop(&mut self) {
        let mut checks = checking();
        if let Some(at) = checks.iter().position(|path| *path == self.0) {
            checks.swap_remove(at);
        }
    }
}

fn checking() -> std::sync::MutexGuard<'static, Vec<PathBuf>> {
    CHECKING.lock().unwrap_or_else(PoisonError::into_inner)
}

async fn enabled(pool: &SqlitePool) -> Result<bool, AppError> {
    Ok(meta(pool, ENABLED_KEY).await?.as_deref() != Some("off"))
}

/// An unreadable stored result reads as "not checked yet".
async fn last(pool: &SqlitePool) -> Result<Option<UpdateCheck>, AppError> {
    Ok(meta(pool, LAST_KEY)
        .await?
        .and_then(|json| serde_json::from_str(&json).ok()))
}

/// Today's local date, `YYYY-MM-DD`; read only by the public entry points.
async fn today(state: &AppState) -> Result<String, AppError> {
    let (pool, _) = db::current(state)?;
    Ok(sqlx::query_scalar("SELECT date('now','localtime')")
        .fetch_one(&pool)
        .await?)
}

async fn load(pool: &SqlitePool, path: &Path) -> Result<UpdateStatus, AppError> {
    let last = last(pool).await?;
    let dismissed = meta(pool, DISMISSED_KEY).await?;
    let banner = match last.as_ref().map(|check| &check.result) {
        // Also hidden once the installed app has caught up with the stored release.
        Some(UpdateResult::Newer { version, url })
            if Some(version) != dismissed.as_ref()
                && version::parse(version) > version::parse(version::APP_VERSION) =>
        {
            Some(NewerRelease {
                version: version.clone(),
                url: url.clone(),
            })
        }
        _ => None,
    };
    Ok(UpdateStatus {
        checks_enabled: enabled(pool).await?,
        checking: checking().iter().any(|check| check == path),
        last,
        banner,
    })
}

pub async fn status(state: &AppState) -> Result<UpdateStatus, AppError> {
    let (pool, path) = db::current(state)?;
    load(&pool, &path).await
}

/// Always checks once, setting on or off; keeps any dismissal.
pub async fn check_now(state: &AppState) -> Result<UpdateStatus, AppError> {
    check_with(state, &today(state).await?, github).await
}

/// Hides the banner for its current version.
pub async fn dismiss(state: &AppState) -> Result<UpdateStatus, AppError> {
    let (pool, path) = db::current(state)?;
    if let Some(banner) = load(&pool, &path).await?.banner {
        set_meta(&pool, DISMISSED_KEY, &banner.version).await?;
    }
    load(&pool, &path).await
}

pub async fn set_enabled(
    state: &AppState,
    request: SetUpdateChecksRequest,
) -> Result<UpdateStatus, AppError> {
    let (pool, path) = db::current(state)?;
    let value = if request.enabled { "on" } else { "off" };
    set_meta(&pool, ENABLED_KEY, value).await?;
    load(&pool, &path).await
}

/// The launch check: once a day when checks are on; failures are stored, not returned.
pub async fn launch_check(state: &AppState) {
    // A database error here leaves the check for the next launch; nothing to show.
    if let Ok(today) = today(state).await {
        launch_with(state, &today, github).await
    }
}

/// The status code and body of one request, or why it never got an answer.
async fn github(request: reqwest::Request) -> Result<(u16, String), String> {
    let reason = |error: reqwest::Error| error.without_url().to_string();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(reason)?;
    let response = client.execute(request).await.map_err(reason)?;
    let status = response.status().as_u16();
    Ok((status, response.text().await.map_err(reason)?))
}

/// The one request: no cookies, auth or query, and no header but these two.
fn request() -> reqwest::Request {
    let mut request = reqwest::Request::new(
        reqwest::Method::GET,
        reqwest::Url::parse(LATEST).expect("LATEST is a valid URL"),
    );
    let agent = format!("Zeni/{}", version::APP_VERSION);
    let headers = request.headers_mut();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_str(&agent).expect("the app version is a valid header"),
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );
    request
}

async fn launch_with(
    state: &AppState,
    today: &str,
    fetch: impl AsyncFn(reqwest::Request) -> Result<(u16, String), String>,
) {
    // A database error here leaves the check for the next launch; nothing to show.
    let _ = try_launch(state, today, fetch).await;
}

async fn try_launch(
    state: &AppState,
    today: &str,
    fetch: impl AsyncFn(reqwest::Request) -> Result<(u16, String), String>,
) -> Result<(), AppError> {
    let (pool, _) = db::current(state)?;
    if !enabled(&pool).await? {
        return Ok(());
    }
    if last(&pool).await?.is_some_and(|check| check.date == today) {
        return Ok(());
    }
    sqlx::query("DELETE FROM app_meta WHERE key = ?")
        .bind(DISMISSED_KEY)
        .execute(&pool)
        .await?;
    check_with(state, today, fetch).await.map(drop)
}

async fn check_with(
    state: &AppState,
    today: &str,
    fetch: impl AsyncFn(reqwest::Request) -> Result<(u16, String), String>,
) -> Result<UpdateStatus, AppError> {
    let (pool, path) = db::current(state)?;
    let result = {
        let _checking = Checking::start(path.clone());
        outcome(fetch(request()).await, version::APP_VERSION)
    };
    let check = UpdateCheck {
        date: today.into(),
        result,
    };
    let json =
        serde_json::to_string(&check).map_err(|error| AppError::Database(error.to_string()))?;
    set_meta(&pool, LAST_KEY, &json).await?;
    load(&pool, &path).await
}

/// The release link must be a Zeni release page on github.com over https.
fn is_release_page(link: &str) -> bool {
    if link.contains("/../") || link.contains("/./") {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(link) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with(RELEASES_PATH)
}

fn outcome(answer: Result<(u16, String), String>, app_version: &str) -> UpdateResult {
    let failed = |reason: String| UpdateResult::Failed { reason };
    let (status, body) = match answer {
        Ok(answer) => answer,
        Err(error) => return failed(format!("Couldn't reach GitHub: {error}")),
    };
    if status != 200 {
        return failed(format!("GitHub answered {status}"));
    }
    let body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let (Some(tag), Some(url)) = (body["tag_name"].as_str(), body["html_url"].as_str()) else {
        return failed("GitHub sent a reply Zeni couldn't read".into());
    };
    let Some(latest) = tag.strip_prefix('v').and_then(version::parse) else {
        return failed(format!("GitHub sent a tag that isn't a version: {tag}"));
    };
    if !is_release_page(url) {
        return failed("GitHub sent an unexpected release link".into());
    }
    if version::parse(app_version).is_some_and(|app| latest <= app) {
        return UpdateResult::UpToDate;
    }
    UpdateResult::Newer {
        version: format!("{}.{}.{}", latest.0, latest.1, latest.2),
        url: url.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::version::APP_VERSION;

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn open(dir: &Path) -> AppState {
        AppState {
            db: std::sync::RwLock::new(run(db::connect(dir))),
            session: Default::default(),
            pending_import: Default::default(),
            backup: Default::default(),
            jobs: Default::default(),
        }
    }

    /// A test's temp dir, removed when dropped.
    struct Dir(PathBuf);

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn fixture(name: &str) -> (Dir, AppState) {
        let dir = db::temp_dir(&format!("updates-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        let state = open(&dir);
        (Dir(dir), state)
    }

    const DAY: &str = "2026-01-01";
    const NEXT_DAY: &str = "2026-01-02";

    /// A stand-in for GitHub that answers every request the same way and keeps each request.
    struct Fake {
        answer: Result<(u16, String), String>,
        requests: Mutex<Vec<reqwest::Request>>,
    }

    fn fake(answer: Result<(u16, String), String>) -> Fake {
        Fake {
            answer,
            requests: Mutex::new(Vec::new()),
        }
    }

    fn release(tag: &str) -> Fake {
        fake(Ok((200, body(tag))))
    }

    fn body(tag: &str) -> String {
        serde_json::json!({
            "tag_name": tag,
            "html_url": format!("https://github.com/Sherlock64/zeni/releases/tag/{tag}"),
            "name": "Zeni",
        })
        .to_string()
    }

    impl Fake {
        async fn fetch(&self, request: reqwest::Request) -> Result<(u16, String), String> {
            self.requests.lock().unwrap().push(request);
            self.answer.clone()
        }

        fn calls(&self) -> usize {
            self.requests.lock().unwrap().len()
        }
    }

    fn check(state: &AppState, fake: &Fake) -> UpdateStatus {
        run(check_with(state, DAY, async |r| fake.fetch(r).await)).unwrap()
    }

    fn launch(state: &AppState, today: &str, fake: &Fake) {
        run(launch_with(state, today, async |r| fake.fetch(r).await));
    }

    fn store_last(state: &AppState, last: &UpdateCheck) {
        let (pool, _) = db::current(state).unwrap();
        let query =
            sqlx::query("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('update_last', ?)")
                .bind(serde_json::to_string(last).unwrap());
        run(query.execute(&pool)).unwrap();
    }

    fn meta(state: &AppState, key: &str) -> Option<String> {
        let (pool, _) = db::current(state).unwrap();
        run(
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = ?")
                .bind(key)
                .fetch_optional(&pool),
        )
        .unwrap()
    }

    fn newer(version: &str) -> UpdateResult {
        UpdateResult::Newer {
            version: version.into(),
            url: format!("https://github.com/Sherlock64/zeni/releases/tag/v{version}"),
        }
    }

    fn failed(reason: &str) -> UpdateResult {
        UpdateResult::Failed {
            reason: reason.into(),
        }
    }

    fn result_of(state: &AppState) -> UpdateResult {
        run(status(state)).unwrap().last.unwrap().result
    }

    #[test]
    fn compares_the_tag_with_the_app_version() {
        let ok = |tag: &str| Ok((200, body(tag)));
        assert_eq!(outcome(ok("v7.1.0"), "7.0.0"), newer("7.1.0"));
        assert_eq!(outcome(ok("v7.0.0"), "7.0.0"), UpdateResult::UpToDate);
        assert_eq!(outcome(ok("v6.1.0"), "7.0.0"), UpdateResult::UpToDate);
        assert_eq!(outcome(ok("v7.10.0"), "7.9.0"), newer("7.10.0"));
    }

    #[test]
    fn fails_with_one_line_reasons() {
        assert_eq!(
            outcome(Err("dns error".into()), "7.0.0"),
            failed("Couldn't reach GitHub: dns error")
        );
        assert_eq!(
            outcome(Ok((404, body("v7.1.0"))), "7.0.0"),
            failed("GitHub answered 404")
        );
        for tag in ["v7", "7.0.0", "v7.0.0-rc1"] {
            assert_eq!(
                outcome(Ok((200, body(tag))), "7.0.0"),
                failed(&format!("GitHub sent a tag that isn't a version: {tag}"))
            );
        }
        for bad in [
            "not json",
            "{}",
            r#"{"tag_name": 7, "html_url": "https://github.com/Sherlock64/zeni/releases/x"}"#,
            r#"{"tag_name": "v7.1.0"}"#,
        ] {
            assert_eq!(
                outcome(Ok((200, bad.into())), "7.0.0"),
                failed("GitHub sent a reply Zeni couldn't read")
            );
        }
    }

    #[test]
    fn rejects_a_release_link_outside_the_releases_page() {
        for url in [
            "https://github.com/Sherlock64/zeni/releasesx",
            "https://github.com/Sherlock64/zeni/",
            "http://github.com/Sherlock64/zeni/releases/tag/v7.1.0",
            "https://evil.example/Sherlock64/zeni/releases/tag/v7.1.0",
            "https://github.com/Other/zeni/releases/tag/v7.1.0",
            "https://github.com/Sherlock64/zeni/releases/../../../other/repo",
            "https://github.com/Sherlock64/zeni/releases/./tag/v7.1.0",
            "https://github.com.evil.example/Sherlock64/zeni/releases/tag/v7.1.0",
            "https://github.com:8443/Sherlock64/zeni/releases/tag/v7.1.0",
            "https://user@github.com/Sherlock64/zeni/releases/tag/v7.1.0",
            "https://github.com/Sherlock64/zeni/releases/%2e%2e/%2e%2e/other",
            "not a url",
        ] {
            let reply = serde_json::json!({"tag_name": "v7.1.0", "html_url": url}).to_string();
            assert_eq!(
                outcome(Ok((200, reply)), "7.0.0"),
                failed("GitHub sent an unexpected release link"),
                "{url}"
            );
        }
    }

    #[test]
    fn accepts_a_zeni_release_tag_link() {
        let link = "https://github.com/Sherlock64/zeni/releases/tag/v7.1.0";
        let reply = serde_json::json!({"tag_name": "v7.1.0", "html_url": link}).to_string();
        assert_eq!(outcome(Ok((200, reply)), "7.0.0"), newer("7.1.0"));
    }

    #[test]
    fn sends_one_get_with_only_the_user_agent_and_accept_headers() {
        let (_dir, state) = fixture("request");
        let github = release("v7.1.0");
        check(&state, &github);
        let requests = github.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let request = &requests[0];
        assert_eq!(request.method(), reqwest::Method::GET);
        assert_eq!(
            request.url().as_str(),
            "https://api.github.com/repos/Sherlock64/zeni/releases/latest"
        );
        assert!(request.body().is_none());
        let headers: Vec<(String, String)> = request
            .headers()
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_str().unwrap().to_string()))
            .collect();
        assert_eq!(
            headers,
            [
                ("user-agent".into(), format!("Zeni/{APP_VERSION}")),
                ("accept".into(), "application/vnd.github+json".into()),
            ]
        );
    }

    #[test]
    fn launch_checks_once_a_day_when_on() {
        let (_dir, state) = fixture("launch-on");
        assert!(run(status(&state)).unwrap().checks_enabled);
        let github = release("v99.0.0");
        launch(&state, DAY, &github);
        assert_eq!(github.calls(), 1);
        let last = run(status(&state)).unwrap().last.unwrap();
        assert_eq!(last.date, DAY);
        assert_eq!(last.result, newer("99.0.0"));
        launch(&state, DAY, &github);
        assert_eq!(github.calls(), 1, "already ran today");
        launch(&state, NEXT_DAY, &github);
        assert_eq!(github.calls(), 2, "a new day");
        assert_eq!(run(status(&state)).unwrap().last.unwrap().date, NEXT_DAY);
    }

    #[test]
    fn launch_makes_no_request_when_off() {
        let (_dir, state) = fixture("launch-off");
        let off = SetUpdateChecksRequest { enabled: false };
        let shown = run(set_enabled(&state, off)).unwrap();
        assert!(!shown.checks_enabled);
        assert_eq!(meta(&state, "update_checks").as_deref(), Some("off"));
        let github = release("v99.0.0");
        launch(&state, DAY, &github);
        assert_eq!(github.calls(), 0);
        assert!(run(status(&state)).unwrap().last.is_none());
        let on = SetUpdateChecksRequest { enabled: true };
        assert!(run(set_enabled(&state, on)).unwrap().checks_enabled);
        launch(&state, DAY, &github);
        assert_eq!(github.calls(), 1);
    }

    #[test]
    fn check_now_always_requests() {
        let (_dir, state) = fixture("check-now");
        let off = SetUpdateChecksRequest { enabled: false };
        run(set_enabled(&state, off)).unwrap();
        let github = release("v7.0.0");
        check(&state, &github);
        check(&state, &github);
        assert_eq!(github.calls(), 2, "off and already checked today");
        assert_eq!(result_of(&state), UpdateResult::UpToDate);
    }

    #[test]
    fn dismiss_hides_the_banner_until_the_next_day_launch_check() {
        let (_dir, state) = fixture("dismiss");
        let github = release("v99.0.0");
        let shown = check(&state, &github);
        let banner = NewerRelease {
            version: "99.0.0".into(),
            url: "https://github.com/Sherlock64/zeni/releases/tag/v99.0.0".into(),
        };
        assert_eq!(shown.banner, Some(banner.clone()));
        assert_eq!(run(dismiss(&state)).unwrap().banner, None);
        assert_eq!(meta(&state, "update_dismissed").as_deref(), Some("99.0.0"));
        assert_eq!(check(&state, &github).banner, None, "check now keeps it");
        launch(&state, DAY, &github);
        assert_eq!(github.calls(), 2, "already ran today");
        assert_eq!(run(status(&state)).unwrap().banner, None);
        // A newer version than the dismissed one shows again.
        assert!(check(&state, &release("v99.1.0")).banner.is_some());
        check(&state, &github);
        // Tomorrow's launch check clears the dismissal.
        launch(&state, NEXT_DAY, &github);
        assert_eq!(github.calls(), 4);
        assert_eq!(meta(&state, "update_dismissed"), None);
        assert_eq!(run(status(&state)).unwrap().banner, Some(banner));
    }

    #[test]
    fn no_banner_without_a_newer_result() {
        let (_dir, state) = fixture("no-banner");
        assert_eq!(run(status(&state)).unwrap().banner, None);
        assert_eq!(run(dismiss(&state)).unwrap().banner, None);
        assert_eq!(meta(&state, "update_dismissed"), None);
        // A stored result the installed app has since caught up with.
        let caught_up = UpdateCheck {
            date: "2000-01-01".into(),
            result: newer(APP_VERSION),
        };
        store_last(&state, &caught_up);
        let shown = run(status(&state)).unwrap();
        assert_eq!(shown.last, Some(caught_up));
        assert_eq!(shown.banner, None);
    }

    #[test]
    fn a_failure_is_stored_and_other_commands_keep_working() {
        let (_dir, state) = fixture("failure");
        let down = fake(Err("connection refused".into()));
        let shown = check(&state, &down);
        assert_eq!(
            shown.last.unwrap().result,
            failed("Couldn't reach GitHub: connection refused")
        );
        launch(&state, DAY, &down);
        assert!(run(dismiss(&state)).is_ok());
        let off = SetUpdateChecksRequest { enabled: false };
        assert!(run(set_enabled(&state, off)).is_ok());
        assert_eq!(
            check(&state, &fake(Ok((500, String::new()))))
                .last
                .unwrap()
                .result,
            failed("GitHub answered 500")
        );
        assert_eq!(
            check(&state, &release("v7.0.0")).last.unwrap().result,
            UpdateResult::UpToDate
        );
    }

    #[test]
    fn result_and_date_survive_reopening() {
        let (dir, state) = fixture("reopen");
        check(&state, &release("v99.0.0"));
        drop(state);
        let reopened = open(&dir.0);
        let last = run(status(&reopened)).unwrap().last.unwrap();
        assert_eq!(
            last,
            UpdateCheck {
                date: DAY.into(),
                result: newer("99.0.0")
            }
        );
    }

    #[test]
    fn checking_is_true_only_during_a_check() {
        let (_dir, state) = fixture("checking");
        assert!(!run(status(&state)).unwrap().checking);
        let during = Mutex::new(None);
        let shown = run(check_with(&state, DAY, async |_| {
            *during.lock().unwrap() = Some(status(&state).await.unwrap().checking);
            Ok((200, body("v7.0.0")))
        }))
        .unwrap();
        assert_eq!(*during.lock().unwrap(), Some(true));
        assert!(!shown.checking);
        let (_other, unrelated) = fixture("checking-other");
        assert!(!run(status(&unrelated)).unwrap().checking);
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
        let github = release("v99.0.0");
        assert!(matches!(run(status(&state)), Err(AppError::Database(_))));
        assert!(matches!(
            run(check_with(&state, DAY, async |r| github.fetch(r).await)),
            Err(AppError::Database(_))
        ));
        assert!(matches!(run(dismiss(&state)), Err(AppError::Database(_))));
        let on = SetUpdateChecksRequest { enabled: true };
        assert!(matches!(
            run(set_enabled(&state, on)),
            Err(AppError::Database(_))
        ));
        launch(&state, DAY, &github);
        assert_eq!(github.calls(), 0);
    }
}
