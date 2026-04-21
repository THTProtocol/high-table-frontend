//! htp-rust-backend/src/wasm/wordduel.rs
//!
//! Block-hash seeded 5-letter timed word game (like Wordle).
//! Seeded from block hash for verifiable fairness.
//! Auto-submit result to oracle on win detection.

use std::vec::Vec;
use std::string::String;
use blake2::{Blake2b, Digest};
use blake2::digest::consts::U32;

const WORD_LIST: [&str; 20] = [
    "APPLE", "BEACH", "CRANE", "DANCE", "EARTH", "FLAME", "GHOST", "HEART", "IVORY",
    "JOLLY", "KNIFE", "LEMON", "MUSIC", "NORTH", "OCEAN", "PIANO", "QUEEN", "RADIO",
    "SNAKE", "TIGER",
];

pub struct WordDuelGame {
    pub seed_hash: String,
    pub target_word: String,
    pub guesses0: Vec<String>,
    pub guesses1: Vec<String>,
    pub winner: Option<u8>,
    pub turn: u8,
    pub max_guesses: u8,
}

impl WordDuelGame {
    pub fn new(block_hash_hex: &str) -> Self {
        let seed = Self::seed_from_hash(block_hash_hex);
        let idx = (seed as usize) % WORD_LIST.len();
        let target = WORD_LIST[idx].to_string();
        Self {
            seed_hash: block_hash_hex.into(),
            target_word: target,
            guesses0: Vec::new(),
            guesses1: Vec::new(),
            winner: None,
            turn: 0,
            max_guesses: 6,
        }
    }

    fn seed_from_hash(hash_hex: &str) -> u64 {
        if hash_hex.len() < 16 { return 0; }
        let mut val: u64 = 0;
        for i in 0..16 {
            let n = u8::from_str_radix(&hash_hex[i*2..i*2+2], 16).unwrap_or(0);
            val = val.wrapping_mul(256).wrapping_add(n as u64);
        }
        val
    }

    pub fn guess(&mut self, player: u8, word: &str,
    ) -> Result<Vec<LetterResult>, String> {
        if word.len() != 5 { return Err("word must be 5 letters".into()); }
        let upper = word.to_ascii_uppercase();
        let mut result = Vec::with_capacity(5);
        let target_chars: Vec<char> = self.target_word.chars().collect();
        let guess_chars: Vec<char> = upper.chars().collect();

        for i in 0..5 {
            if guess_chars[i] == target_chars[i] {
                result.push(LetterResult::Correct);
            } else if target_chars.contains(&guess_chars[i]) {
                result.push(LetterResult::Present);
            } else {
                result.push(LetterResult::Absent);
            }
        }

        if player == 0 { self.guesses0.push(upper.clone()); }
        else { self.guesses1.push(upper.clone()); }

        if upper == self.target_word {
            self.winner = Some(player);
            self.turn += 1;
            return Ok(result);
        }

        if self.guesses0.len() as u8 >= self.max_guesses
            && self.guesses1.len() as u8 >= self.max_guesses
        {
            self.winner = Some(0); // default tiebreak
        }
        self.turn += 1;
        Ok(result)
    }

    pub fn game_state_hash(&self) -> String {
        let mut data = Vec::new();
        data.extend_from_slice(self.seed_hash.as_bytes());
        data.extend_from_slice(self.target_word.as_bytes());
        for g in &self.guesses0 { data.extend_from_slice(g.as_bytes()); }
        for g in &self.guesses1 { data.extend_from_slice(g.as_bytes()); }
        if let Some(w) = self.winner { data.push(w); }
        let mut hasher = <Blake2b<U32>>::new();
        hasher.update(&data);
        hex::encode(hasher.finalize())
    }
}

#[derive(Clone, Copy, Debug)]
pub enum LetterResult {
    Correct,  // green
    Present,  // yellow
    Absent,   // gray
}
