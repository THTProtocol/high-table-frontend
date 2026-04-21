//! htp-rust-backend/src/attestor/mod.rs
//!
//! M-of-N attestor module. N=1 now, code for N.

use std::collections::HashMap;
use blake2::{Blake2b, Digest};
use blake2::digest::consts::U32;

pub mod broadcast;
pub mod firebase_listener;
pub mod multi_sig;

pub struct Attestor {
    pub id: String,
    pub pubkey: Vec<u8>,
    pub privkey: Vec<u8>,
}

impl Attestor {
    pub fn sign_deterministic(
        &self,
        escrow_id: &str,
        winner_pubkey_hex: &str,
        game_state_hash_hex: &str,
        block_daa_score: u64,
    ) -> String {
        let mut data = Vec::new();
        data.extend_from_slice(b"HTP_DETERMINISTIC_SIGN");
        data.extend_from_slice(escrow_id.as_bytes());
        data.extend_from_slice(winner_pubkey_hex.as_bytes());
        data.extend_from_slice(game_state_hash_hex.as_bytes());
        data.extend_from_slice(&block_daa_score.to_le_bytes());
        // Sign with private key (placeholder: hash-based for now)
        let mut hasher = <Blake2b<U32>>::new();
        hasher.update(&data);
        hasher.update(&self.privkey);
        hex::encode(hasher.finalize())
    }
}

pub struct AttestorSet {
    pub threshold: u8,
    pub attestors: Vec<Attestor>,
}

impl AttestorSet {
    pub fn new(threshold: u8) -> Self {
        Self { threshold, attestors: Vec::new() }
    }
    pub fn add(&mut self, a: Attestor) {
        self.attestors.push(a);
    }
    pub fn has_enough_sigs(&self, sigs: &HashMap<String, String>) -> bool {
        sigs.len() >= self.threshold as usize
    }
}
