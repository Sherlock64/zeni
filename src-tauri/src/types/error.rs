use serde::Serialize;
use ts_rs::TS;

/// Every command error. Serialized as `{ kind, message }` for the UI.
#[derive(Debug, thiserror::Error, Serialize, TS)]
#[serde(tag = "kind", content = "message")]
#[ts(export)]
pub enum AppError {
    #[error("{0}")]
    Database(String),
    #[error("{0}")]
    Validation(String),
    /// The data key isn't loaded, or setup is already done / not done for the called command.
    #[error("{0}")]
    Locked(String),
    #[error("{0}")]
    WrongPassword(String),
    /// Malformed, used or unknown recovery code.
    #[error("{0}")]
    InvalidRecoveryCode(String),
    #[error("{0}")]
    NotFound(String),
    /// A stored value failed to decrypt, or a crypto/RNG failure.
    #[error("{0}")]
    Crypto(String),
    /// An import file that can't be read, isn't a supported OFX/QFX/CSV bank statement, or isn't in US dollars.
    #[error("{0}")]
    Import(String),
    /// Backup folder, backup write, restore validation and restore failures.
    #[error("{0}")]
    Backup(String),
    /// Another Ollama job is running, or a category edit waits for categorizing to finish.
    #[error("{0}")]
    Busy(String),
    /// Ollama is unreachable, returned an error, or no base model is picked.
    #[error("{0}")]
    Ollama(String),
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Database(error.to_string())
    }
}

/// Turns a JSON encode or decode failure on stored data into a database error.
impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        use serde_json::error::Category;
        let category = match error.classify() {
            Category::Io => "io",
            Category::Syntax => "syntax",
            Category::Data => "data",
            Category::Eof => "eof",
        };
        Self::Database(format!(
            "Couldn't read or write stored data ({category} at {}:{})",
            error.line(),
            error.column()
        ))
    }
}

impl From<sqlx::migrate::MigrateError> for AppError {
    fn from(error: sqlx::migrate::MigrateError) -> Self {
        Self::Database(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_error_becomes_a_database_error_without_its_input() {
        let error = serde_json::from_str::<i64>("\"secret-token\"").unwrap_err();
        let AppError::Database(message) = AppError::from(error) else {
            panic!("not a database error");
        };
        assert_eq!(message, "Couldn't read or write stored data (data at 1:14)");
        assert!(!message.contains("secret-token"));
    }

    #[test]
    fn app_error_serializes_as_kind_and_message() {
        let json = serde_json::to_value(AppError::Validation("boom".into())).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "Validation", "message": "boom" })
        );
    }
}
