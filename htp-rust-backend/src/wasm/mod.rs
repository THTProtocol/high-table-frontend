//! High Table Protocol - WASM Covenant/Escrow Module
//!
//! Full trustless covenant escrow implementation with KIP-17/KIP-20 support
//! All money handling in u64 SOMPI (1 KAS = 100,000,000 sompi)

pub mod autopayout;
pub mod backgammon;
pub mod blackjack;
pub mod board_engine;
pub mod coinflip;
pub mod covenant_escrow;
pub mod fee_engine;
pub mod poker;
pub mod rps;
pub mod wordduel;
pub mod zk_pipeline;

// Re-export commonly used types
pub use autopayout::{AutoPayout, UtxoSelector};
pub use board_engine::{BoardEngine, GameState, ValidationResult};
pub use covenant_escrow::{
    build_cancel_tx, build_deadline_tx, build_leave_tx, build_settlement_tx,
encode_covenant_id_kip20, CovenantEscrow, CovenantId, CovenantSpend,
    SpendPath,
};
pub use fee_engine::FeeEngine;

#[cfg(target_arch = "wasm32")]
use js_sys::Array;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsValue;

// WASM FFI exports for JavaScript interop
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn calculate_fee(total_sompi: u64, fee_bps: u32) -> u64 {
    FeeEngine::calculate_fee_sompi(total_sompi, fee_bps)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn calculate_winner_payout(total_sompi: u64, fee_bps: u32) -> u64 {
    FeeEngine::winner_payout_sompi(total_sompi, fee_bps)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmCovenantEscrow {
    inner: CovenantEscrow,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmCovenantEscrow {
    #[wasm_bindgen(constructor)]
    pub fn new(
        match_id: &str,
        creator_pubkey: &str,
        network: &str,
    ) -> Result<WasmCovenantEscrow, JsValue> {
        let inner = CovenantEscrow::new(match_id, creator_pubkey, network)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(WasmCovenantEscrow { inner })
    }

    #[wasm_bindgen(js_name = getEscrowAddress)]
    pub fn escrow_address(&self) -> String { self.inner.escrow_address.clone() }

    #[wasm_bindgen(js_name = getRedeemScript)]
    pub fn redeem_script(&self) -> String { hex::encode(&self.inner.redeem_script) }

    #[wasm_bindgen(js_name = getCovenantId)]
    pub fn covenant_id(&self) -> String { self.inner.covenant_id.clone() }

    #[wasm_bindgen(js_name = setOpponent)]
    pub fn set_opponent(&mut self, opponent_pubkey: &str) -> Result<(), JsValue> {
        self.inner
            .set_opponent(opponent_pubkey)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = setAttestor)]
    pub fn set_attestor(&mut self, attestor_pubkey: &str) {
        self.inner.set_attestor(attestor_pubkey);
    }

    #[wasm_bindgen(js_name = setDeadline)]
    pub fn set_deadline(&mut self, deadline_block: u64) {
        self.inner.set_deadline(deadline_block);
    }

    #[wasm_bindgen(js_name = canCancel)]
    pub fn can_cancel(&self) -> bool {
        self.inner.can_cancel()
    }
}

// NEW: WASM bindgen exports for Agent 17
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = "skillWinPot")]
pub fn skill_win_pot(sompi: u64) -> Array {
    let (winner, fee) = FeeEngine::skill_win(sompi);
    let arr = Array::new();
    arr.push(&JsValue::from_f64(winner as f64));
    arr.push(&JsValue::from_f64(fee as f64));
    arr
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = "hedgeClaim")]
pub fn hedge_claim(sompi: u64) -> Array {
    let (payout, fee) = FeeEngine::hedge_claim(sompi);
    let arr = Array::new();
    arr.push(&JsValue::from_f64(payout as f64));
    arr.push(&JsValue::from_f64(fee as f64));
    arr
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = "eventWinStdStake")]
pub fn event_win_std_stake(sompi: u64, odds_num: u64, odds_den: u64) -> Array {
    let (winner, fee) = FeeEngine::event_win_std(sompi, odds_num, odds_den);
    let arr = Array::new();
    arr.push(&JsValue::from_f64(winner as f64));
    arr.push(&JsValue::from_f64(fee as f64));
    arr
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = "boardApplyMove")]
pub fn board_apply_move(state_json: &str, move_san: &str) -> String {
    // Deserialize or create default GameState
    let mut state = match serde_json::from_str::<GameState>(state_json) {
        Ok(s) => s,
        Err(_) => {
            GameState {
                game_type: crate::wasm::board_engine::GameType::Chess,
                fen_or_state: state_json.to_string(),
                player_index: 0,
                move_history: Vec::new(),
                turn_count: 0,
                is_complete: false,
                winner_index: None,
            }
        },
    };
    // Run move validation
    let res = state.apply_move(move_san);
    // Serialize state back
    serde_json::to_string(&(serde_json::json!({
        "fen_or_state": state.fen_or_state,
        "player_index": state.player_index,
        "move_history": state.move_history,
        "turn_count": state.turn_count,
        "is_complete": state.is_complete,
        "winner_index": state.winner_index,
        "validation_result": match res {
            ValidationResult::Valid => "Valid",
            ValidationResult::Invalid(s) => "Invalid",
            ValidationResult::Winner(n) => "Winner",
            ValidationResult::Draw => "Draw",
        },
    }))).unwrap()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = "calculateFee")]
pub fn wasm_calculate_fee(total_sompi: u64, fee_bps: u32) -> u64 {
    FeeEngine::calculate_fee_sompi(total_sompi, fee_bps)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = "calculateWinnerPayout")]
pub fn wasm_winner_payout(total_sompi: u64, fee_bps: u32) -> u64 {
    FeeEngine::winner_payout_sompi(total_sompi, fee_bps)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = "encodeCovenantId")]
pub fn wasm_encode_covenant_id(
    tx_id: &str,
    vout: u32,
    auth_outputs_json: &str,
) -> Result<String, JsValue> {
    let auth_outputs: Vec<(u32, u64, Vec<u8>)> = serde_json::from_str(auth_outputs_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid JSON: {}", e)))?;

    let covenant_id = encode_covenant_id_kip20(tx_id, vout, &auth_outputs)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(covenant_id)
}

// === Poker WASM wrapper ===
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmPokerGame { inner: poker::PokerGame }

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmPokerGame {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u64) -> WasmPokerGame {
        WasmPokerGame { inner: poker::PokerGame::new(seed) }
    }
    #[wasm_bindgen(js_name = placeBet)]
    pub fn place_bet(&mut self, player: u8, amount_sompi: u64) {
        self.inner.place_bet(player, amount_sompi);
    }
    #[wasm_bindgen]
    pub fn fold(&mut self, player: u8) { self.inner.fold(player); }
    #[wasm_bindgen]
    pub fn call(&mut self, player: u8) { self.inner.call(player); }
    #[wasm_bindgen]
    pub fn check(&mut self, player: u8) { self.inner.check(player); }
    #[wasm_bindgen(js_name = startGame)]
    pub fn start_game(&mut self, stake_sompi: u64) { self.inner.start_game(stake_sompi); }
    #[wasm_bindgen(js_name = dealFlop)]
    pub fn deal_flop(&mut self) { self.inner.deal_flop(); }
    #[wasm_bindgen(js_name = dealTurn)]
    pub fn deal_turn(&mut self) { self.inner.deal_turn(); }
    #[wasm_bindgen(js_name = dealRiver)]
    pub fn deal_river(&mut self) { self.inner.deal_river(); }
    #[wasm_bindgen(js_name = doShowdown)]
    pub fn do_showdown(&mut self) { self.inner.do_showdown(); }
    #[wasm_bindgen(js_name = getStateJson)]
    pub fn get_state_json(&self) -> String { self.inner.get_state_json() }
    #[wasm_bindgen(js_name = getWinner)]
    pub fn get_winner(&self) -> Option<u8> { self.inner.winner }
    #[wasm_bindgen(js_name = getPayoutSompi)]
    pub fn get_payout_sompi(&self) -> u64 { self.inner.get_payout_sompi() }
    #[wasm_bindgen(js_name = getFeeSompi)]
    pub fn get_fee_sompi(&self) -> u64 { self.inner.get_fee_sompi() }
    #[wasm_bindgen(js_name = getHoleCardsJson)]
    pub fn get_hole_cards_json(&self) -> String { self.inner.get_hole_cards_json() }
    #[wasm_bindgen(js_name = getCommunityJson)]
    pub fn get_community_json(&self) -> String { self.inner.get_community_json() }
}

// === Blackjack WASM wrapper ===
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmBlackjackGame { inner: blackjack::BlackjackGame }

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmBlackjackGame {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u64) -> WasmBlackjackGame {
        WasmBlackjackGame { inner: blackjack::BlackjackGame::new(seed) }
    }
    #[wasm_bindgen(js_name = placeBet)]
    pub fn place_bet(&mut self, amount_sompi: u64) { self.inner.place_bet(amount_sompi); }
    #[wasm_bindgen(js_name = deal)]
    pub fn deal(&mut self) { self.inner.deal(); }
    #[wasm_bindgen(js_name = hit)]
    pub fn hit(&mut self) { self.inner.hit(); }
    #[wasm_bindgen(js_name = stand)]
    pub fn stand(&mut self) { self.inner.stand(); }
    #[wasm_bindgen(js_name = doubleDown)]
    pub fn double_down(&mut self) { self.inner.double_down(); }
    #[wasm_bindgen(js_name = getStateJson)]
    pub fn get_state_json(&self) -> String { self.inner.get_state_json() }
    #[wasm_bindgen(js_name = getPayoutSompi)]
    pub fn get_payout_sompi(&self) -> u64 { self.inner.get_payout_sompi() }
    #[wasm_bindgen(js_name = getFeeSompi)]
    pub fn get_fee_sompi(&self) -> u64 { self.inner.get_fee_sompi() }
    #[wasm_bindgen(js_name = getWinnerLabel)]
    pub fn get_winner_label(&self) -> String { self.inner.get_winner_label() }
    #[wasm_bindgen(js_name = getPlayerCardsJson)]
    pub fn get_player_cards_json(&self) -> String { self.inner.get_player_cards_json() }
    #[wasm_bindgen(js_name = getDealerCardsJson)]
    pub fn get_dealer_cards_json(&self) -> String { self.inner.get_dealer_cards_json() }
    #[wasm_bindgen(js_name = canCancel)]
    pub fn can_cancel(&self) -> bool { self.inner.can_cancel() }
}
