//! The one Ollama job (a categorize run, a download or a build): start, progress, cancel and status.

use std::future::Future;
use std::sync::{Arc, MutexGuard, PoisonError};

use tokio::sync::watch;

use crate::types::{AppError, JobCtx, JobKind, JobOutcome, JobSlot, JobStatus, Jobs, RunningJob};

fn slot(jobs: &Jobs) -> MutexGuard<'_, JobSlot> {
    jobs.0.lock().unwrap_or_else(PoisonError::into_inner)
}

fn snapshot(slot: &JobSlot) -> JobStatus {
    JobStatus {
        running: slot.running.clone(),
        last: slot.last.clone(),
    }
}

/// Runs `work` as the one job, or returns `Busy` while another runs. When the work ends, its
/// outcome moves to `last` and the slot frees. `work` is called under the slot lock, so it must only
/// build its future; everything it does belongs inside that future.
pub fn start<F, Fut>(
    jobs: &Jobs,
    kind: JobKind,
    label: String,
    work: F,
) -> Result<JobStatus, AppError>
where
    F: FnOnce(JobCtx) -> Fut,
    Fut: Future<Output = JobOutcome> + Send + 'static,
{
    let mut guard = slot(jobs);
    if let Some(running) = &guard.running {
        return Err(AppError::Busy(format!(
            "{} is running. Wait for it to finish or cancel it.",
            running.label
        )));
    }
    let cancel = Arc::new(watch::Sender::new(false));
    guard.cancel = cancel.clone();
    guard.running = Some(RunningJob {
        kind,
        label: label.clone(),
        done: 0,
        total: 0,
    });
    let work = tauri::async_runtime::spawn(work(JobCtx {
        jobs: jobs.clone(),
        cancel,
    }));
    let finished = jobs.clone();
    // Spawned under the lock, so the task can't finish before its handle is stored.
    guard.handle = Some(tauri::async_runtime::spawn(async move {
        // A panicking job still frees the slot.
        let outcome = work.await.unwrap_or_else(|_| JobOutcome {
            kind,
            error: Some(format!("{label} stopped unexpectedly.")),
            label,
            cancelled: false,
            summary: None,
        });
        let mut slot = slot(&finished);
        slot.running = None;
        slot.handle = None;
        slot.last = Some(outcome);
    }));
    Ok(snapshot(&guard))
}

impl JobCtx {
    /// Rows, or bytes for a download; `total` 0 means unknown.
    pub fn progress(&self, done: u64, total: u64) {
        if let Some(running) = slot(&self.jobs).running.as_mut() {
            running.done = done;
            running.total = total;
        }
    }

    pub fn cancelled(&self) -> bool {
        *self.cancel.borrow()
    }

    /// Resolves once the job is cancelled, at once if it already is, so `select!` can drop work.
    pub async fn until_cancelled(&self) {
        // `wait_for` checks the current value first, so a cancel before this call is not missed.
        // Its error (sender dropped) can't happen: `self.cancel` keeps the sender alive.
        let _ = self
            .cancel
            .subscribe()
            .wait_for(|cancelled| *cancelled)
            .await;
    }
}

/// `Busy` while a categorize run is going, so category edits wait for it.
pub fn refuse_while_categorizing(jobs: &Jobs) -> Result<(), AppError> {
    let categorizing = slot(jobs).running.as_ref().is_some_and(|running| {
        matches!(
            running.kind,
            JobKind::CategorizeNow | JobKind::RecategorizeAll | JobKind::AfterImport
        )
    });
    if categorizing {
        return Err(AppError::Busy("Wait for categorizing to finish.".into()));
    }
    Ok(())
}

pub fn status(jobs: &Jobs) -> JobStatus {
    snapshot(&slot(jobs))
}

/// Asks the running job to stop; a no-op when idle.
pub fn cancel(jobs: &Jobs) {
    slot(jobs).cancel.send_replace(true);
}

pub fn clear_outcome(jobs: &Jobs) {
    slot(jobs).last = None;
}

/// Cancels the running job and waits until it has ended, so its pool can be swapped out.
pub async fn stop_and_wait(jobs: &Jobs) {
    let handle = {
        let mut slot = slot(jobs);
        slot.cancel.send_replace(true);
        slot.handle.take()
    };
    if let Some(handle) = handle {
        // Its error is a panic in the wrapper, which only moves the outcome; nothing to wait for then.
        let _ = handle.await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    use super::*;

    fn outcome(kind: JobKind, label: &str, cancelled: bool) -> JobOutcome {
        JobOutcome {
            kind,
            label: label.into(),
            cancelled,
            error: None,
            summary: None,
        }
    }

    /// Starts a job that reports progress, then runs until cancelled.
    fn start_until_cancelled(jobs: &Jobs, kind: JobKind, label: &str) -> JobStatus {
        let owned = label.to_string();
        start(jobs, kind, label.into(), move |ctx| async move {
            ctx.progress(2, 5);
            while !ctx.cancelled() {
                std::thread::sleep(Duration::from_millis(2));
            }
            outcome(kind, &owned, true)
        })
        .unwrap()
    }

    fn wait_until_idle(jobs: &Jobs) -> JobStatus {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let current = status(jobs);
            if current.running.is_none() {
                return current;
            }
            assert!(Instant::now() < deadline, "the job never ended");
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    #[test]
    fn a_second_job_is_refused_while_one_runs() {
        let jobs = Jobs::default();
        let started = start_until_cancelled(&jobs, JobKind::Download, "Download phi4-mini");
        assert_eq!(started.running.unwrap().label, "Download phi4-mini");

        let error = start(&jobs, JobKind::Build, "Build zeni-1".into(), |_| async {
            outcome(JobKind::Build, "Build zeni-1", false)
        })
        .unwrap_err();
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "kind": "Busy",
                "message": "Download phi4-mini is running. Wait for it to finish or cancel it."
            })
        );
        tauri::async_runtime::block_on(stop_and_wait(&jobs));
    }

    #[test]
    fn progress_shows_and_cancel_is_observed_then_the_outcome_moves_to_last() {
        let jobs = Jobs::default();
        start_until_cancelled(&jobs, JobKind::CategorizeNow, "Categorize now");
        let deadline = Instant::now() + Duration::from_secs(5);
        while status(&jobs).running.unwrap().done != 2 {
            assert!(Instant::now() < deadline, "no progress");
            std::thread::sleep(Duration::from_millis(2));
        }
        assert_eq!(status(&jobs).running.unwrap().total, 5);

        cancel(&jobs);
        let done = wait_until_idle(&jobs);
        let last = done.last.unwrap();
        assert_eq!(
            (last.kind, last.label.as_str(), last.cancelled),
            (JobKind::CategorizeNow, "Categorize now", true)
        );
        assert!(slot(&jobs).handle.is_none());

        // The slot is free again, and the outcome stays until cleared.
        let next = start(&jobs, JobKind::Build, "Build zeni-2".into(), |_| async {
            outcome(JobKind::Build, "Build zeni-2", false)
        })
        .unwrap();
        assert_eq!(next.last.unwrap().label, "Categorize now");
        assert_eq!(wait_until_idle(&jobs).last.unwrap().label, "Build zeni-2");
        clear_outcome(&jobs);
        assert!(status(&jobs).last.is_none());
    }

    #[test]
    fn cancel_and_stop_and_wait_do_nothing_when_idle() {
        let jobs = Jobs::default();
        cancel(&jobs);
        tauri::async_runtime::block_on(stop_and_wait(&jobs));
        let idle = status(&jobs);
        assert!(idle.running.is_none() && idle.last.is_none());
        // An earlier cancel doesn't leak into the next job.
        let flag = Arc::new(AtomicBool::new(true));
        let seen = flag.clone();
        start(
            &jobs,
            JobKind::Build,
            "Build zeni-1".into(),
            move |ctx| async move {
                seen.store(ctx.cancelled(), Ordering::Relaxed);
                outcome(JobKind::Build, "Build zeni-1", false)
            },
        )
        .unwrap();
        wait_until_idle(&jobs);
        assert!(!flag.load(Ordering::Relaxed));
    }

    #[test]
    fn stop_and_wait_cancels_and_waits_for_the_work_to_end() {
        let jobs = Jobs::default();
        let ended = Arc::new(AtomicBool::new(false));
        let flag = ended.clone();
        start(
            &jobs,
            JobKind::Build,
            "Build zeni-1".into(),
            move |ctx| async move {
                while !ctx.cancelled() {
                    std::thread::sleep(Duration::from_millis(2));
                }
                // Still busy after the cancel, as a job finishing its current request is.
                std::thread::sleep(Duration::from_millis(50));
                flag.store(true, Ordering::Relaxed);
                outcome(JobKind::Build, "Build zeni-1", true)
            },
        )
        .unwrap();
        tauri::async_runtime::block_on(stop_and_wait(&jobs));
        assert!(ended.load(Ordering::Relaxed));
        let done = status(&jobs);
        assert!(done.running.is_none());
        assert!(done.last.unwrap().cancelled);
    }

    #[test]
    fn a_panicking_job_frees_the_slot() {
        let jobs = Jobs::default();
        start(
            &jobs,
            JobKind::Download,
            "Download qwen2.5:3b".into(),
            |_| async { panic!("boom") },
        )
        .unwrap();
        let last = wait_until_idle(&jobs).last.unwrap();
        assert_eq!(
            last.error.as_deref(),
            Some("Download qwen2.5:3b stopped unexpectedly.")
        );
    }

    #[test]
    fn only_categorize_runs_refuse_category_edits() {
        for (kind, refused) in [
            (JobKind::CategorizeNow, true),
            (JobKind::RecategorizeAll, true),
            (JobKind::AfterImport, true),
            (JobKind::Download, false),
            (JobKind::Build, false),
        ] {
            let jobs = Jobs::default();
            assert!(refuse_while_categorizing(&jobs).is_ok());
            start_until_cancelled(&jobs, kind, "Job");
            let result = refuse_while_categorizing(&jobs);
            assert_eq!(result.is_err(), refused, "{kind:?}");
            if let Err(error) = result {
                assert_eq!(
                    serde_json::to_value(error).unwrap(),
                    serde_json::json!({
                        "kind": "Busy",
                        "message": "Wait for categorizing to finish."
                    })
                );
            }
            tauri::async_runtime::block_on(stop_and_wait(&jobs));
        }
    }
}
