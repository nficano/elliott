use elliott_hot_core::{EpochTable, StreamingScanner};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

#[napi(object)]
pub struct NativeScanMatch {
    pub pattern: String,
    pub end_offset: f64,
}

#[napi]
pub struct NativeScanner {
    inner: StreamingScanner,
}

#[napi]
impl NativeScanner {
    #[napi(constructor)]
    pub fn new(patterns: Vec<String>) -> napi::Result<Self> {
        let inner = StreamingScanner::new(patterns).map_err(napi::Error::from_reason)?;
        Ok(Self { inner })
    }

    #[napi]
    pub fn push(&mut self, chunk: String) -> Vec<NativeScanMatch> {
        self.inner
            .push(&chunk)
            .into_iter()
            .filter_map(|found| {
                self.inner
                    .pattern(found.pattern)
                    .map(|pattern| NativeScanMatch {
                        pattern: pattern.to_owned(),
                        end_offset: found.end as f64,
                    })
            })
            .collect()
    }

    #[napi]
    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

#[napi]
pub struct NativeEpochTable {
    inner: EpochTable,
}

#[napi]
impl NativeEpochTable {
    #[napi(constructor)]
    pub fn new(size: u32) -> Self {
        Self {
            inner: EpochTable::new(size as usize),
        }
    }

    #[napi]
    pub fn read(&self, index: u32) -> Option<u32> {
        self.inner.read(index as usize)
    }

    #[napi]
    pub fn bump(&self, index: u32) -> Option<u32> {
        self.inner.bump(index as usize)
    }
}

#[napi]
pub fn blake3_digest(input: Buffer) -> String {
    elliott_hot_core::digest(input.as_ref())
}

#[napi]
pub fn audit_chain_link(previous: Option<String>, payload: Buffer) -> String {
    elliott_hot_core::chain_link(previous.as_deref(), payload.as_ref())
}

#[napi]
pub fn audit_merkle_root(leaves: Vec<String>) -> String {
    elliott_hot_core::merkle_root(&leaves)
}
