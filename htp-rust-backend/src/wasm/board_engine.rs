//! htp-rust-backend/src/wasm/board_engine.rs
//!
//! Generic game-state validation engine with covenant integration.

use std::vec::Vec;
use std::string::String;

#[derive(Debug, PartialEq)]
pub enum GameType {
    Chess,
    Checkers,
    ConnectFour,
    Backgammon,
    Rps,
    Coinflip,
    WordDuel,
}

#[derive(Debug)]
pub enum ValidationResult {
    Valid,
    Invalid(String),
    Winner(u8), // player index 0 or 1
    Draw,
}

/// Generic board state.
pub struct GameState {
    pub game_type: GameType,
    pub fen_or_state: String,
    pub player_index: u8,
    pub move_history: Vec<String>,
    pub turn_count: u32,
    pub is_complete: bool,
    pub winner_index: Option<u8>,
}

impl GameState {
    pub fn new(game_type: GameType) -> Self {
        Self {
            game_type,
            fen_or_state: String::new(),
            player_index: 0,
            move_history: Vec::new(),
            turn_count: 0,
            is_complete: false,
            winner_index: None,
        }
    }

    pub fn apply_move(&mut self, _move_san: &str) -> ValidationResult {
        self.move_history.push(_move_san.into());
        self.turn_count += 1;
        self.player_index = 1 - self.player_index;
        ValidationResult::Valid
    }

    pub fn resign(&mut self, player: u8) -> ValidationResult {
        self.is_complete = true;
        self.winner_index = Some(1 - player);
        ValidationResult::Winner(1 - player)
    }

    pub fn leave(&mut self, player: u8) -> ValidationResult {
        self.is_complete = true;
        self.winner_index = Some(1 - player);
        ValidationResult::Winner(1 - player)
    }
}

/// Board validation interface.
pub trait BoardEngine {
    fn validate_move(&self, state: &GameState, move_san: &str) -> ValidationResult;
    fn check_win(&self, state: &GameState) -> ValidationResult;
    fn serialize_state(&self, state: &GameState) -> String;
}

/// Stub engine that always returns valid (for WASM interop testing).
pub struct StubEngine;
impl BoardEngine for StubEngine {
    fn validate_move(&self, _state: &GameState, _move_san: &str) -> ValidationResult {
        ValidationResult::Valid
    }
    fn check_win(&self, _state: &GameState) -> ValidationResult {
        ValidationResult::Valid
    }
    fn serialize_state(&self, state: &GameState) -> String {
        state.fen_or_state.clone()
    }
}
