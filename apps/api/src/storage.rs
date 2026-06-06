use crate::config::Config;
use axum::body::Body;
use bytes::Bytes;
use futures_util::{stream::BoxStream, TryStreamExt};
use object_store::aws::AmazonS3Builder;
use object_store::local::LocalFileSystem;
use object_store::path::Path as ObjPath;
use object_store::{ObjectStore, ObjectStoreExt, WriteMultipart};
use std::sync::Arc;

#[derive(Clone)]
pub struct BlobStore {
    inner: Arc<dyn ObjectStore>,
}

impl BlobStore {
    pub fn from_config(cfg: &Config) -> anyhow::Result<Self> {
        let inner: Arc<dyn ObjectStore> = match cfg.storage_backend.as_str() {
            "local" => {
                std::fs::create_dir_all(&cfg.storage_local_path)?;
                Arc::new(LocalFileSystem::new_with_prefix(&cfg.storage_local_path)?)
            }
            "s3" => {
                let mut b = AmazonS3Builder::new()
                    .with_bucket_name(&cfg.s3_bucket)
                    .with_region(cfg.s3_region.clone().unwrap_or_else(|| "us-east-1".into()))
                    .with_access_key_id(&cfg.s3_access_key)
                    .with_secret_access_key(&cfg.s3_secret_key);
                if let Some(ep) = &cfg.s3_endpoint {
                    b = b
                        .with_endpoint(ep.clone())
                        .with_allow_http(ep.starts_with("http://"))
                        .with_virtual_hosted_style_request(false); // MinIO needs path-style
                }
                Arc::new(b.build()?)
            }
            other => anyhow::bail!("invalid storage_backend={other}"),
        };
        Ok(Self { inner })
    }

    /// Streaming upload; never buffers the whole blob. Returns bytes written.
    pub async fn put_stream(&self, key: &str, body: Body) -> anyhow::Result<u64> {
        let upload = self.inner.put_multipart(&ObjPath::from(key)).await?;
        let mut w = WriteMultipart::new(upload);
        let mut total: u64 = 0;
        let mut s = body.into_data_stream();
        // Stream chunks into WriteMultipart.  We must avoid consuming `w` inside an inner async
        // block so that we can call either w.finish() or w.abort() depending on outcome —
        // both methods consume `self` (by value) in object_store 0.13.
        let stream_result: anyhow::Result<()> = async {
            while let Some(chunk) = s
                .try_next()
                .await
                .map_err(|e| anyhow::anyhow!("body read error: {e}"))?
            {
                w.wait_for_capacity(8).await?;
                total += chunk.len() as u64;
                w.write(&chunk);
            }
            Ok(())
        }
        .await;

        match stream_result {
            Ok(()) => {
                w.finish().await?;
                Ok(total)
            }
            Err(e) => {
                // best-effort abort to avoid orphaned S3 multipart parts
                let _ = w.abort().await;
                Err(e)
            }
        }
    }

    /// Lazy byte stream for Body::from_stream.
    pub async fn get_stream(
        &self,
        key: &str,
    ) -> object_store::Result<BoxStream<'static, object_store::Result<Bytes>>> {
        let res = self.inner.get(&ObjPath::from(key)).await?;
        Ok(res.into_stream())
    }

    pub async fn delete(&self, key: &str) -> object_store::Result<()> {
        self.inner.delete(&ObjPath::from(key)).await
    }
}
