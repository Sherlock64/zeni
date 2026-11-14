use sqlx::{SqliteConnection, SqlitePool};

use crate::crypto::{self, ACCOUNT_NUMBER_AAD, ROUTING_NUMBER_AAD};
use crate::security;
use crate::types::{
    Account, AccountNumbers, AppError, AppState, DataKey, NewAccount, RevealAccountNumbersRequest,
};

const MAX_TEXT_CHARS: usize = 100;

/// Trims the text fields and strips spaces from the numbers; rejects anything out of range.
pub fn validate(account: NewAccount) -> Result<NewAccount, AppError> {
    Ok(NewAccount {
        name: text("name", &account.name)?,
        owner: text("owner", &account.owner)?,
        bank_name: text("bankName", &account.bank_name)?,
        account_number: digits("accountNumber", &account.account_number, 4, 17)?,
        routing_number: routing_number(&account.routing_number)?,
    })
}

fn text(field: &str, value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::Validation(format!("{field} must not be empty")));
    }
    if value.chars().count() > MAX_TEXT_CHARS {
        return Err(AppError::Validation(format!(
            "{field} must be at most {MAX_TEXT_CHARS} characters"
        )));
    }
    Ok(value.to_owned())
}

fn digits(field: &str, value: &str, min: usize, max: usize) -> Result<String, AppError> {
    let digits: String = value.chars().filter(|c| !c.is_whitespace()).collect();
    if digits.bytes().all(|b| b.is_ascii_digit()) && (min..=max).contains(&digits.len()) {
        return Ok(digits);
    }
    Err(AppError::Validation(if min == max {
        format!("{field} must be exactly {min} digits")
    } else {
        format!("{field} must be {min} to {max} digits")
    }))
}

fn routing_number(value: &str) -> Result<String, AppError> {
    let number = digits("routingNumber", value, 9, 9)?;
    let checksum: u32 = number
        .bytes()
        .zip([3, 7, 1].iter().cycle())
        .map(|(digit, weight)| u32::from(digit - b'0') * weight)
        .sum();
    if !checksum.is_multiple_of(10) {
        return Err(AppError::Validation(
            "routingNumber must be a valid ABA routing number".into(),
        ));
    }
    Ok(number)
}

/// Inserts a validated account, encrypting its numbers with `key`.
pub async fn insert(
    connection: &mut SqliteConnection,
    key: &DataKey,
    account: &NewAccount,
) -> Result<(), AppError> {
    let account_number =
        crypto::encrypt(key, ACCOUNT_NUMBER_AAD, account.account_number.as_bytes())?;
    let routing_number =
        crypto::encrypt(key, ROUTING_NUMBER_AAD, account.routing_number.as_bytes())?;
    sqlx::query(
        "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&account.name)
    .bind(&account.owner)
    .bind(&account.bank_name)
    .bind(account_number)
    .bind(routing_number)
    .execute(connection)
    .await?;
    Ok(())
}

/// The plain-text fields of every account, by id. Works locked or unlocked.
pub async fn list(state: &AppState) -> Result<Vec<Account>, AppError> {
    let pool: &SqlitePool = security::pool(state)?;
    let rows: Vec<(i64, String, String, String)> =
        sqlx::query_as("SELECT id, name, owner, bank_name FROM accounts ORDER BY id")
            .fetch_all(pool)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(id, name, owner, bank_name)| Account {
            id,
            name,
            owner,
            bank_name,
        })
        .collect())
}

/// Decrypts one account's numbers. Needs the data key in memory.
pub async fn reveal(
    state: &AppState,
    request: RevealAccountNumbersRequest,
) -> Result<AccountNumbers, AppError> {
    let pool = security::pool(state)?;
    let key = security::session_key(state)?;
    let row: Option<(Vec<u8>, Vec<u8>)> =
        sqlx::query_as("SELECT account_number, routing_number FROM accounts WHERE id = ?")
            .bind(request.account_id)
            .fetch_optional(pool)
            .await?;
    let (account_number, routing_number) =
        row.ok_or_else(|| AppError::NotFound("That account doesn't exist.".into()))?;
    Ok(AccountNumbers {
        account_number: decrypt_text(&key, ACCOUNT_NUMBER_AAD, &account_number)?,
        routing_number: decrypt_text(&key, ROUTING_NUMBER_AAD, &routing_number)?,
    })
}

fn decrypt_text(key: &DataKey, aad: &[u8], blob: &[u8]) -> Result<String, AppError> {
    String::from_utf8(crypto::decrypt(key, aad, blob)?.to_vec())
        .map_err(|_| AppError::Crypto("A stored value isn't valid text.".into()))
}

#[cfg(test)]
pub fn sample_account() -> NewAccount {
    NewAccount {
        name: " Checking ".into(),
        owner: "Sherlock".into(),
        bank_name: "First Bank".into(),
        account_number: "1234 5678 9012".into(),
        routing_number: "011 000 015".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(change: impl FnOnce(&mut NewAccount)) -> Result<NewAccount, String> {
        let mut account = sample_account();
        change(&mut account);
        validate(account).map_err(|error| match error {
            AppError::Validation(message) => message,
            _ => panic!("expected a validation error"),
        })
    }

    #[test]
    fn validate_trims_text_and_strips_spaces_from_numbers() {
        let account = with(|_| {}).unwrap();
        assert_eq!(account.name, "Checking");
        assert_eq!(account.account_number, "123456789012");
        assert_eq!(account.routing_number, "011000015");
    }

    #[test]
    fn text_fields_are_1_to_100_chars_after_trimming() {
        for (field, set) in [
            ("name", (|a, v| a.name = v) as fn(&mut NewAccount, String)),
            ("owner", |a, v| a.owner = v),
            ("bankName", |a, v| a.bank_name = v),
        ] {
            assert!(with(|a| set(a, "é".repeat(100))).is_ok());
            assert!(with(|a| set(a, format!("  {}  ", "a".repeat(100)))).is_ok());
            assert!(with(|a| set(a, "a".into())).is_ok());
            assert_eq!(
                with(|a| set(a, "a".repeat(101))).err().unwrap(),
                format!("{field} must be at most 100 characters")
            );
            assert_eq!(
                with(|a| set(a, "   ".into())).err().unwrap(),
                format!("{field} must not be empty")
            );
        }
    }

    #[test]
    fn account_number_is_4_to_17_digits() {
        let error = "accountNumber must be 4 to 17 digits";
        assert!(with(|a| a.account_number = "1234".into()).is_ok());
        assert!(with(|a| a.account_number = "1".repeat(17)).is_ok());
        assert_eq!(
            with(|a| a.account_number = "123".into()).err().unwrap(),
            error
        );
        assert_eq!(
            with(|a| a.account_number = "1".repeat(18)).err().unwrap(),
            error
        );
        assert_eq!(
            with(|a| a.account_number = "1234a".into()).err().unwrap(),
            error
        );
        assert_eq!(
            with(|a| a.account_number = "12-34".into()).err().unwrap(),
            error
        );
    }

    #[test]
    fn routing_number_is_9_digits_with_aba_checksum() {
        let length = "routingNumber must be exactly 9 digits";
        assert!(with(|a| a.routing_number = "021000021".into()).is_ok());
        assert_eq!(
            with(|a| a.routing_number = "011000016".into())
                .err()
                .unwrap(),
            "routingNumber must be a valid ABA routing number"
        );
        assert_eq!(
            with(|a| a.routing_number = "01100001".into())
                .err()
                .unwrap(),
            length
        );
        assert_eq!(
            with(|a| a.routing_number = "0110000150".into())
                .err()
                .unwrap(),
            length
        );
        assert_eq!(
            with(|a| a.routing_number = "01100001x".into())
                .err()
                .unwrap(),
            length
        );
    }
}
