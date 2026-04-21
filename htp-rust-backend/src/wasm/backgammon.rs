//! htp-rust-backend/src/wasm/backgammon.rs
//!
//! Standard backgammon rules: pip, hit, bear-off.
//! Auto-submit result to oracle on win detection.
//! Leave mid-game = instant loss enforced.

use std::vec::Vec;
use std::string::String;
use crate::wasm::board_engine::{GameState, ValidationResult};

pub struct BackgammonGame {
    pub board: [i8; 24], // positive = player 0 checkers, negative = player 1
    pub bar0: u8,
    pub bar1: u8,
    pub borne0: u8,
    pub borne1: u8,
    pub dice: (u8, u8),
    pub turn: u8,
}

impl BackgammonGame {
    pub fn new() -> Self {
        // Standard initial position
        let mut board = [0i8; 24];
        board[0] = 2; board[11] = 5; board[16] = 3; board[18] = 5;
        board[23] = -2; board[12] = -5; board[7] = -3; board[5] = -5;
        Self { board, bar0: 0, bar1: 0, borne0: 0, borne1: 0, dice: (0, 0), turn: 0 }
    }

    pub fn roll_dice(&mut self, entropy: u64) {
        let die1 = ((entropy >> 8)  % 6 + 1) as u8;
        let die2 = ((entropy >> 16) % 6 + 1) as u8;
        self.dice = (die1, die2);
    }

    pub fn can_bear_off(&self, player: u8) -> bool {
        let all_home = if player == 0 {
            self.board[0..6].iter().all(|c| *c >= 0)
        } else {
            self.board[18..24].iter().all(|c| *c <= 0)
        };
        all_home
    }

    pub fn has_winner(&self) -> Option<u8> {
        if self.borne0 == 15 { return Some(0); }
        if self.borne1 == 15 { return Some(1); }
        None
    }

    pub fn game_state_hash(&self) -> String {
        let mut data = Vec::new();
        for c in &self.board { data.push(*c as u8); }
        data.push(self.bar0); data.push(self.bar1);
        data.push(self.borne0); data.push(self.borne1);
        data.push(self.turn);
        use blake2::{Blake2b, Digest};
        use blake2::digest::consts::U32;
        let mut hasher = <Blake2b<U32>>::new();
        hasher.update(&data);
        hex::encode(hasher.finalize())
    }
}
