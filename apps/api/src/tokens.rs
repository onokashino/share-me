use base64::Engine;
use rand::TryRngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// 32 CSPRNG bytes, base64url no padding.
pub fn gen_token() -> String {
    let mut b = [0u8; 32];
    rand::rngs::OsRng.try_fill_bytes(&mut b).expect("OsRng fill failed");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// Public share id: 21-char url-safe nanoid.
pub fn new_id() -> String {
    nanoid::nanoid!()
}

/// Lowercase hex SHA-256, used to store token hashes (owner/upload) and to
/// compare a presented download-auth token's hash against the stored one.
pub fn sha256_hex(input: &str) -> String {
    let mut h = Sha256::new();
    h.update(input.as_bytes());
    hex::encode(h.finalize())
}

/// Constant-time compare of two equal-length hex hash strings.
pub fn hash_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_unique_and_urlsafe() {
        let (t1, t2) = (gen_token(), gen_token());
        assert_ne!(t1, t2);
        assert!(!t1.contains('+') && !t1.contains('/') && !t1.contains('='));
    }

    #[test]
    fn sha256_and_const_time_eq() {
        let t = gen_token();
        let h = sha256_hex(&t);
        assert_eq!(h.len(), 64);
        assert!(hash_eq(&h, &sha256_hex(&t)));
        assert!(!hash_eq(&h, &sha256_hex("other")));
        assert!(!hash_eq(&h, "short"));
    }
}
