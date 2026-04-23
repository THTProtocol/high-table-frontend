//! High Table Protocol - WASM Library
//!
//! This library exposes WASM bindings for the High Table Protocol backend.
//! All financial calculations use u64 SOMPI (1 KAS = 100,000,000 sompi).

pub mod multisig;
pub mod wasm;

// Re-export WASM bindings
pub use wasm::*;

// Re-export multisig types for external use
pub use multisig::{
    aggregate_signatures, generate_nonce_round, verify_threshold_signature, ThresholdConfig,
};

// Export when building for WASM target
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
pub fn init() {
    // Initialize console error panic hook for better debugging
    console_error_panic_hook::set_once();
}