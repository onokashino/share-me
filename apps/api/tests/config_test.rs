use figment::Jail;
use share_me_api::config::Config;

#[test]
fn defaults_require_public_base_url() {
    Jail::expect_with(|jail| {
        jail.clear_env();
        // no PUBLIC_BASE_URL -> validation must fail
        assert!(Config::load().is_err(), "missing PUBLIC_BASE_URL should error");
        Ok(())
    });
}

#[test]
fn minimal_local_config_loads() {
    Jail::expect_with(|jail| {
        jail.clear_env();
        jail.set_env("PUBLIC_BASE_URL", "https://share.example");
        let cfg = Config::load().expect("should load");
        assert_eq!(cfg.storage_backend, "local");
        assert_eq!(cfg.database_url, "sqlite://data/share-me.db");
        assert_eq!(cfg.max_file_size, 5_368_709_120);
        Ok(())
    });
}

#[test]
fn s3_backend_requires_bucket_and_keys() {
    Jail::expect_with(|jail| {
        jail.clear_env();
        jail.set_env("PUBLIC_BASE_URL", "https://share.example");
        jail.set_env("STORAGE_BACKEND", "s3");
        assert!(Config::load().is_err(), "s3 without bucket/keys must error");
        jail.set_env("S3_BUCKET", "b");
        jail.set_env("S3_ACCESS_KEY", "k");
        jail.set_env("S3_SECRET_KEY", "s");
        assert!(Config::load().is_ok(), "s3 with bucket/keys must load");
        Ok(())
    });
}

#[test]
fn max_expiry_must_be_ge_default_expiry() {
    Jail::expect_with(|jail| {
        jail.clear_env();
        jail.set_env("PUBLIC_BASE_URL", "https://share.example");
        jail.set_env("DEFAULT_EXPIRY_SECS", "1000000");
        jail.set_env("MAX_EXPIRY_SECS", "10");
        assert!(Config::load().is_err(), "default > max must error");
        Ok(())
    });
}
