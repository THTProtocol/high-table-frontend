//! htp-rust-backend/src/wasm/rps.rs
//!
//! Rock-Paper-Scissors: best-of-3, commit-reveal pattern.
//! Commit: hash(move_salt_hex) sent to covenant.
//! Reveal: move + salt shown, hash verified.

use std::vec::Vec;
use std::string::String;
use blake2::{Blake2b, Digest};
use blake2::digest::consts::U32;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Move {
    Rock = 0,
    Paper = 1,
    Scissors = 2,
}

impl Move {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Move::Rock),
            1 => Some(Move::Paper),
            2 => Some(Move::Scissors),
            _ => None,
        }
    }

    pub fn beats(self, other: Move) -> bool {
        matches!(
            (self, other),
            (Move::Rock, Move::Scissors)
                | (Move::Paper, Move::Rock)
                | (Move::Scissors, Move::Paper)
        )
    }
}

pub struct RpsGame {
    pub round: u8,
    pub score0: u8,
    pub score1: u8,
    pub commits: [Option<String>; 6], // 3 rounds x 2 players
    pub reveals: [Option<Move>; 6],
    pub round_salt: String,
}

impl RpsGame {
    pub fn new() -> Self {
        Self {
            round: 0,
            score0: 0,
            score1: 0,
            commits: [None; 6],
            reveals: [None; 6],
            round_salt: String::new(),
        }
    }

    /// Hash(move_hex + salt_hex) using Blake2b.
    pub fn hash_commit(move_hex: &str, salt: &str) -> String {
        let input = format!("{}", move_hex);
        let full = format!("{}{}", input, salt);
        let mut hasher = <Blake2b<U32>>::new();
        hasher.update(full.as_bytes());
        hex::encode(hasher.finalize())
    }

    pub fn verify_commit(&self, player: u8, round: u8, move_hex: &str, salt: &str,
    ) -> bool {
        let idx = (round as usize) * 2 + (player as usize);
        let expected = Self::hash_commit(move_hex, salt);
        match &self.commits[idx] {
            Some(c) => c == &expected,
            None => false,
        }
    }

    pub fn play_round(&mut self, move0: Move, move1: Move) {
        let idx0 = (self.round as usize) * 2 + 0;
        let idx1 = (self.round as usize) * 2 + 1;
        self.reveals[idx0] = Some(move0);
        self.reveals[idx1] = Some(move1);
        if move0 == move1 { /* draw */ }
        else if move0.beats(move1) { self.score0 += 1; }
        else { self.score1 += 1; }
        self.round += 1;
    }

    pub fn winner(&self) -> Option<u8> {
        if self.score0 >= 2 { return Some(0); }
        if self.score1 >= 2 { return Some(1); }
        None
    }

    pub fn winner_hash(&self) -> String {
        let mut data = Vec::new();
        data.push(self.score0); data.push(self.score1); data.push(self.round);
        let mut hasher = <Blake2b<U32>>::new();
        hasher.update(&data);
        hex::encode(hasher.finalize())
    }
}
