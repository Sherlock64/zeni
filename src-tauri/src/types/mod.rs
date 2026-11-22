//! Shared types, one file per domain. Everything is re-exported here, so `use crate::types::X` works.

mod accounts;
mod backup;
mod categories;
mod categorize;
mod error;
mod imports;
mod jobs;
mod nicknames;
mod ollama;
mod security;
mod spending;
mod startup;
mod state;
mod transactions;
mod updates;

pub use accounts::*;
pub use backup::*;
pub use categories::*;
pub use categorize::*;
pub use error::*;
pub use imports::*;
pub use jobs::*;
pub use nicknames::*;
pub use ollama::*;
pub use security::*;
pub use spending::*;
pub use startup::*;
pub use state::*;
pub use transactions::*;
pub use updates::*;
