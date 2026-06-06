use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct Config {
    pub public_base_url: String,
    pub bind_addr: String,
    pub storage_backend: String,
    pub storage_local_path: String,
    pub s3_endpoint: Option<String>,
    pub s3_region: Option<String>,
    pub s3_bucket: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub database_url: String,
    pub max_file_size: u64,
    pub default_expiry_secs: i64,
    pub max_expiry_secs: i64,
    pub max_downloads_cap: Option<i64>,
    pub resume_ttl_secs: i64,
    pub upload_token_ttl_secs: i64,
    pub expiry_sweep_secs: u64,
    pub rate_limit_per_sec: u32,
    pub rate_limit_burst: u32,
    pub require_upload_password: bool,
    pub tor_enabled: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            public_base_url: String::new(),
            bind_addr: "0.0.0.0:8080".into(),
            storage_backend: "local".into(),
            storage_local_path: "data/blobs".into(),
            s3_endpoint: None,
            s3_region: None,
            s3_bucket: String::new(),
            s3_access_key: String::new(),
            s3_secret_key: String::new(),
            database_url: "sqlite://data/share-me.db".into(),
            max_file_size: 5_368_709_120, // 5 GiB; env MAX_FILE_SIZE overrides, 0 = unlimited
            default_expiry_secs: 7 * 24 * 3600,
            max_expiry_secs: 30 * 24 * 3600,
            max_downloads_cap: None,
            resume_ttl_secs: 3600,
            upload_token_ttl_secs: 3600,
            expiry_sweep_secs: 60,
            rate_limit_per_sec: 20,
            rate_limit_burst: 40,
            require_upload_password: false,
            tor_enabled: true,
        }
    }
}

impl Config {
    /// Load from env (bare names) over the defaults, then validate. 12-factor fail-fast.
    pub fn load() -> anyhow::Result<Self> {
        use figment::{providers::{Env, Serialized}, Figment};
        let cfg: Config = Figment::from(Serialized::defaults(Config::default()))
            .merge(Env::raw())
            .extract()?;
        cfg.validate()?;
        Ok(cfg)
    }

    /// Call at startup; on Err, print and exit(1).
    pub fn load_or_exit() -> Self {
        match Self::load() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("invalid configuration: {e:#}");
                std::process::exit(1);
            }
        }
    }

    fn validate(&self) -> anyhow::Result<()> {
        use anyhow::{bail, ensure};
        ensure!(!self.public_base_url.trim().is_empty(), "PUBLIC_BASE_URL is required");
        match self.storage_backend.as_str() {
            "local" => {}
            "s3" => {
                ensure!(!self.s3_bucket.is_empty(), "S3_BUCKET required for storage_backend=s3");
                ensure!(!self.s3_access_key.is_empty(), "S3_ACCESS_KEY required for storage_backend=s3");
                ensure!(!self.s3_secret_key.is_empty(), "S3_SECRET_KEY required for storage_backend=s3");
            }
            other => bail!("STORAGE_BACKEND must be local|s3 (got {other})"),
        }
        let url = &self.database_url;
        ensure!(
            url.starts_with("sqlite:") || url.starts_with("postgres://") || url.starts_with("postgresql://"),
            "DATABASE_URL must be a sqlite: or postgres:// url"
        );
        ensure!(self.max_expiry_secs >= self.default_expiry_secs, "MAX_EXPIRY_SECS must be >= DEFAULT_EXPIRY_SECS");
        if let Some(cap) = self.max_downloads_cap {
            ensure!(cap > 0, "MAX_DOWNLOADS_CAP must be > 0");
        }
        ensure!(self.rate_limit_per_sec > 0 && self.rate_limit_burst > 0, "rate limits must be > 0");
        ensure!(self.resume_ttl_secs >= 0, "RESUME_TTL_SECS must be >= 0");
        Ok(())
    }

    pub fn is_sqlite(&self) -> bool {
        self.database_url.starts_with("sqlite:")
    }
}
