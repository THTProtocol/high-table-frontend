//! htp-rust-backend/src/attestor/multi_sig.rs
//! M-of-N multi-sig scaffolding for Phase 2.

use std::collections::HashMap;

pub struct MultiSig {} 

impl MultiSig {
    pub fn aggregate_sigs(
        sigs: &HashMap<String, String>,
        _threshold: u8,
    ) -> Option<String> {
        if sigs.is_empty() { return None; }
        // Phase 1: return first sig
        // Phase 2: BLS or Schnorr aggregation
        sigs.values().next().cloned()
    }
}
