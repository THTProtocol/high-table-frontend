//! htp-rust-backend/src/wasm/coinflip.rs
//!
//! Commit-reveal coin flip using block-hash entropy.
//! Commit: hash(side + salt) — side 0=heads, 1=tails.
//! Reveal: show side + salt, block hash determines winner.

use std::string::String;
use blake2::{Blake2b, Digest};
use blake2::digest::consts::U32;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CoinSide {
    Heads = 0,
    Tails = 1,
}

pub struct CoinflipGame {
    pub commit0: Option<String>,
    pub commit1: Option<String>,
    pub choice0: Option<CoinSide>, // 0=heads, 1=tails
    pub choice1: Option<CoinSide>,
    pub reveal0: Option<String>,
    pub reveal1: Option<String>,
    pub winner: Option<u8>,
}

impl CoinflipGame {
    pub fn new() -> Self {
        Self { commit0: None, commit1: None, choice0: None, choice1: None, reveal0: None, reveal1: None, winner: None }
    }

    /// Hash(side_hex + salt) for commit phase.
    pub fn hash_commit(side: CoinSide, salt: &str) -> String {
        let payload = format!("{}{}", side as u8, salt);
        let mut hasher = <Blake2b<U32>>::new();
        hasher.update(payload.as_bytes());
        hex::encode(hasher.finalize())
    }

    pub fn verify_commit(commit: &str, side: CoinSide, salt: &str) -> bool {
        Self::hash_commit(side, salt) == commit
    }

    /// Determine winner from block hash.
    /// last_byte % 2 == 0 -> heads wins, else tails wins.
    pub fn resolve_winner(block_hash_hex: &str) -> Option<CoinSide> {
        if block_hash_hex.len() < 2 { return None; }
        let last = u8::from_str_radix(&block_hash_hex[block_hash_hex.len()-2..], 16).ok()?;
        if last % 2 == 0 { Some(CoinSide::Heads) } else { Some(CoinSide::Tails) }
    }

    pub fn finalize(&mut self, block_hash_hex: &str) {
        if let Some(winning_side) = Self::resolve_winner(block_hash_hex) {
            // player who chose the winning side wins
            let winning_player = match (&self.choice0, &self.choice1) {
                (Some(c0), Some(c1)) => {
                    if (*c0 as u8) == (winning_side as u8) { Some(0u8) }
                    else if (*c1 as u8) == (winning_side as u8) { Some(1u8) }
                    else { None }
                }
                _ => None,
            };
            self.winner = winning_player;
        }
    }
}
