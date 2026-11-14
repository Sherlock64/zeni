use std::future::Future;
use std::time::Duration;

use oo7::dbus::{Collection, Error, Service};
use oo7::zbus;
use zeroize::Zeroizing;

use crate::types::{DataKey, KeyringLoad};

/// Where the data key is cached so launches can skip the master password. Tests use a fake.
pub trait Keyring {
    /// Reads the item for `key_id`. Never prompts.
    async fn load(&self, key_id: &str) -> KeyringLoad;
    /// Stores (or replaces) the item for `key_id`; false when the keyring is locked or unreachable.
    async fn store(&self, key_id: &str, key: &DataKey) -> bool;
    /// Best effort: removes the item for `key_id` when the keyring is unlocked.
    async fn delete(&self, key_id: &str);
}

/// The desktop Secret Service (gnome-keyring etc.) over D-Bus, default collection.
pub struct SecretService;

const TIMEOUT: Duration = Duration::from_secs(5);
const LABEL: &str = "Zeni data key";

fn attributes(key_id: &str) -> [(&'static str, String); 2] {
    [("application", "zeni".into()), ("key_id", key_id.into())]
}

/// The default collection if it exists and is unlocked. Never creates or unlocks one, so never prompts.
async fn unlocked_collection() -> Result<Result<Collection, KeyringLoad>, Error> {
    let connection = zbus::connection::Builder::session()
        .method_timeout(TIMEOUT)
        .build()
        .await?;
    let service = Service::new_with_connection(&connection).await?;
    Ok(
        match service.with_alias(Service::DEFAULT_COLLECTION).await? {
            None => Err(KeyringLoad::Missing),
            Some(collection) if collection.is_locked().await? => Err(KeyringLoad::Locked),
            Some(collection) => Ok(collection),
        },
    )
}

/// Runs `work` with a hard time limit. `None` on error or timeout.
async fn bounded<T: Send + 'static>(
    work: impl Future<Output = Result<T, Error>> + Send + 'static,
) -> Option<T> {
    // shortcut: std channel + blocking wait because tokio's timer isn't a direct dependency.
    let (sender, receiver) = std::sync::mpsc::channel();
    let task = tauri::async_runtime::spawn(async move {
        let _ = sender.send(work.await);
    });
    let result = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(TIMEOUT)).await;
    task.abort();
    result.ok()?.ok()?.ok()
}

impl Keyring for SecretService {
    async fn load(&self, key_id: &str) -> KeyringLoad {
        let attributes = attributes(key_id);
        bounded(async move {
            let collection = match unlocked_collection().await? {
                Ok(collection) => collection,
                Err(load) => return Ok(load),
            };
            let Some(item) = collection
                .search_items(&attributes)
                .await?
                .into_iter()
                .next()
            else {
                return Ok(KeyringLoad::Missing);
            };
            if item.is_locked().await? {
                return Ok(KeyringLoad::Locked);
            }
            let secret = item.secret().await?;
            Ok(match <[u8; 32]>::try_from(secret.as_bytes()) {
                Ok(bytes) => KeyringLoad::Found(DataKey(Zeroizing::new(bytes))),
                Err(_) => KeyringLoad::Missing,
            })
        })
        .await
        .unwrap_or(KeyringLoad::Unavailable)
    }

    async fn store(&self, key_id: &str, key: &DataKey) -> bool {
        let attributes = attributes(key_id);
        let secret = Zeroizing::new(key.0.to_vec());
        bounded(async move {
            let Ok(collection) = unlocked_collection().await? else {
                return Ok(false);
            };
            collection
                .create_item(LABEL, &attributes, secret, true, None)
                .await?;
            Ok(true)
        })
        .await
        .unwrap_or(false)
    }

    async fn delete(&self, key_id: &str) {
        let attributes = attributes(key_id);
        bounded(async move {
            if let Ok(collection) = unlocked_collection().await? {
                for item in collection.search_items(&attributes).await? {
                    item.delete(None).await?;
                }
            }
            Ok(())
        })
        .await;
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn bounded_maps_ok_err_and_timeout() {
        assert_eq!(run(bounded(async { Ok(7) })), Some(7));
        assert_eq!(
            run(bounded(async { Err::<(), _>(Error::NotFound("x".into())) })),
            None
        );
        let start = Instant::now();
        assert_eq!(
            run(bounded(std::future::pending::<Result<(), Error>>())),
            None
        );
        let waited = start.elapsed();
        assert!(waited >= TIMEOUT && waited < TIMEOUT * 2, "{waited:?}");
    }
}
