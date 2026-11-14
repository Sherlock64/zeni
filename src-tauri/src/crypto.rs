use aes_gcm::Aes256Gcm;
use aes_gcm::aead::{Aead, Generate, KeyInit, Nonce, Payload};
use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

use crate::types::{AppError, DataKey, KdfParams, KeyWrap};

pub const PASSWORD_KDF: KdfParams = KdfParams {
    m_kib: 65536,
    t: 3,
    p: 1,
};
pub const RECOVERY_KDF: KdfParams = KdfParams {
    m_kib: 19456,
    t: 2,
    p: 1,
};
pub const ACCOUNT_NUMBER_AAD: &[u8] = b"zeni:accounts.account_number";
pub const ROUTING_NUMBER_AAD: &[u8] = b"zeni:accounts.routing_number";
const DATA_KEY_AAD: &[u8] = b"zeni:data-key";
const NONCE_LEN: usize = 12;
const CODE_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LEN: usize = 20;

fn crypto_error() -> AppError {
    AppError::Crypto("Couldn't decrypt or encrypt a stored value.".into())
}

/// `N` bytes from the OS random number generator.
pub fn random<const N: usize>() -> Result<[u8; N], AppError> {
    <[u8; N]>::try_generate().map_err(|_| AppError::Crypto("The system RNG failed.".into()))
}

pub fn new_data_key() -> Result<DataKey, AppError> {
    Ok(DataKey(Zeroizing::new(random()?)))
}

/// Random 128-bit id, as 32 lowercase hex chars.
pub fn new_key_id() -> Result<String, AppError> {
    Ok(random::<16>()?.iter().map(|b| format!("{b:02x}")).collect())
}

/// AES-256-GCM with a fresh random nonce; returns `nonce || ciphertext+tag`.
pub fn encrypt(key: &DataKey, aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new(&(*key.0).into());
    let nonce = Nonce::<Aes256Gcm>::try_generate().map_err(|_| crypto_error())?;
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| crypto_error())?;
    Ok([nonce.as_slice(), &ciphertext].concat())
}

/// Reverses `encrypt`. Fails with `Crypto` on a wrong key, wrong AAD or tampered blob.
pub fn decrypt(key: &DataKey, aad: &[u8], blob: &[u8]) -> Result<Zeroizing<Vec<u8>>, AppError> {
    if blob.len() < NONCE_LEN {
        return Err(crypto_error());
    }
    let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
    let nonce = Nonce::<Aes256Gcm>::try_from(nonce).map_err(|_| crypto_error())?;
    Aes256Gcm::new(&(*key.0).into())
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| crypto_error())
}

/// Argon2id: a 256-bit key from `secret` and `salt`.
fn derive_key(secret: &[u8], salt: &[u8], params: KdfParams) -> Result<DataKey, AppError> {
    let failed = |_| AppError::Crypto("Couldn't derive a key.".into());
    let params = Params::new(params.m_kib, params.t, params.p, Some(32)).map_err(failed)?;
    let mut out = DataKey(Zeroizing::new([0; 32]));
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(secret, salt, &mut *out.0)
        .map_err(failed)?;
    Ok(out)
}

/// Encrypts the data key under a key derived from `secret`. Returns `(salt, wrapped_key)`.
pub fn wrap_key(secret: &[u8], params: KdfParams, key: &DataKey) -> Result<KeyWrap, AppError> {
    let salt = random::<16>()?;
    let wrapping_key = derive_key(secret, &salt, params)?;
    Ok((salt, encrypt(&wrapping_key, DATA_KEY_AAD, &*key.0)?))
}

/// Reverses `wrap_key`. `None` means `secret` is wrong (or the row was tampered with).
pub fn unwrap_key(
    secret: &[u8],
    salt: &[u8],
    params: KdfParams,
    wrapped: &[u8],
) -> Result<Option<DataKey>, AppError> {
    let wrapping_key = derive_key(secret, salt, params)?;
    let Ok(bytes) = decrypt(&wrapping_key, DATA_KEY_AAD, wrapped) else {
        return Ok(None);
    };
    let key = <[u8; 32]>::try_from(bytes.as_slice()).map_err(|_| crypto_error())?;
    Ok(Some(DataKey(Zeroizing::new(key))))
}

/// A new recovery code: 20 Crockford base32 chars (100 bits), unformatted.
pub fn new_recovery_code() -> Result<String, AppError> {
    // 256 is a multiple of 32, so masking keeps every char equally likely.
    let bytes = Zeroizing::new(random::<CODE_LEN>()?);
    Ok(bytes
        .iter()
        .map(|b| char::from(CODE_ALPHABET[usize::from(b & 31)]))
        .collect())
}

/// `XXXXX-XXXXX-XXXXX-XXXXX`, for display.
pub fn format_recovery_code(code: &str) -> String {
    let chars: Vec<char> = code.chars().collect();
    chars
        .chunks(5)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-")
}

/// Uppercases and drops spaces and `-`; the result must be 20 alphabet chars.
pub fn normalize_recovery_code(input: &str) -> Result<Zeroizing<String>, AppError> {
    let code: Zeroizing<String> = Zeroizing::new(
        input
            .chars()
            .filter(|c| *c != ' ' && *c != '-')
            .map(|c| c.to_ascii_uppercase())
            .collect(),
    );
    if code.len() == CODE_LEN && code.bytes().all(|b| CODE_ALPHABET.contains(&b)) {
        Ok(code)
    } else {
        Err(invalid_recovery_code())
    }
}

pub fn invalid_recovery_code() -> AppError {
    AppError::InvalidRecoveryCode("That recovery code isn't valid or was already used.".into())
}

#[cfg(test)]
pub const TEST_KDF: KdfParams = KdfParams {
    m_kib: 64,
    t: 1,
    p: 1,
};

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> DataKey {
        new_data_key().unwrap()
    }

    #[test]
    fn production_kdf_params_match_contract() {
        assert_eq!(
            PASSWORD_KDF,
            KdfParams {
                m_kib: 65536,
                t: 3,
                p: 1
            }
        );
        assert_eq!(
            RECOVERY_KDF,
            KdfParams {
                m_kib: 19456,
                t: 2,
                p: 1
            }
        );
    }

    #[test]
    fn encrypt_round_trips_and_rejects_wrong_key_aad_or_tampering() {
        let key = key();
        let blob = encrypt(&key, ACCOUNT_NUMBER_AAD, b"123456789").unwrap();
        assert_eq!(blob.len(), NONCE_LEN + 9 + 16);
        assert_eq!(
            decrypt(&key, ACCOUNT_NUMBER_AAD, &blob).unwrap().as_slice(),
            b"123456789"
        );
        // A fresh nonce each time.
        assert_ne!(
            blob,
            encrypt(&key, ACCOUNT_NUMBER_AAD, b"123456789").unwrap()
        );

        let mut tampered = blob.clone();
        *tampered.last_mut().unwrap() ^= 1;
        for (key, aad, blob) in [
            (&self::key(), ACCOUNT_NUMBER_AAD, &blob[..]),
            (&key, ROUTING_NUMBER_AAD, &blob[..]),
            (&key, ACCOUNT_NUMBER_AAD, &tampered[..]),
            (&key, ACCOUNT_NUMBER_AAD, &blob[..5]),
        ] {
            assert!(matches!(decrypt(key, aad, blob), Err(AppError::Crypto(_))));
        }
    }

    #[test]
    fn wrap_unwraps_only_with_the_right_secret() {
        let key = key();
        let (salt, wrapped) = wrap_key(b"right password", TEST_KDF, &key).unwrap();
        let unwrapped = unwrap_key(b"right password", &salt, TEST_KDF, &wrapped)
            .unwrap()
            .unwrap();
        assert_eq!(*unwrapped.0, *key.0);
        assert!(
            unwrap_key(b"wrong password", &salt, TEST_KDF, &wrapped)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn key_id_is_128_bit_hex() {
        let id = new_key_id().unwrap();
        assert_eq!(id.len(), 32);
        assert!(
            id.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        );
        assert_ne!(id, new_key_id().unwrap());
    }

    #[test]
    fn recovery_codes_format_and_normalize() {
        let code = new_recovery_code().unwrap();
        assert_eq!(code.len(), 20);
        let shown = format_recovery_code(&code);
        assert_eq!(shown.len(), 23);
        assert_eq!(shown.matches('-').count(), 3);
        assert_eq!(*normalize_recovery_code(&shown).unwrap(), code);
        assert_eq!(
            *normalize_recovery_code(" abcde-fghjk mnpqr-stvwx ").unwrap(),
            "ABCDEFGHJKMNPQRSTVWX"
        );
        for bad in [
            "ABCDE-FGHJK-MNPQR-STVW",   // 19 chars
            "ABCDE-FGHJK-MNPQR-STVWXY", // 21 chars
            "ABCDE-FGHJK-MNPQR-STVWI",  // I isn't in the alphabet
            "ABCDE_FGHJK_MNPQR_STVWX",  // other separators aren't dropped
            "",
        ] {
            assert!(matches!(
                normalize_recovery_code(bad),
                Err(AppError::InvalidRecoveryCode(_))
            ));
        }
    }
}
