#![forbid(unsafe_code)]

use elliott_hot_core::StreamingScanner;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmScanner {
    inner: StreamingScanner,
}

#[wasm_bindgen]
impl WasmScanner {
    #[wasm_bindgen(constructor)]
    pub fn new(patterns: Vec<String>) -> Result<WasmScanner, JsError> {
        let inner = StreamingScanner::new(patterns).map_err(|error| JsError::new(&error))?;
        Ok(Self { inner })
    }

    pub fn push(&mut self, chunk: &str) -> Vec<u32> {
        self.inner
            .push(chunk)
            .into_iter()
            .flat_map(|found| [found.pattern as u32, found.start as u32, found.end as u32])
            .collect()
    }
}
