//! High Table Protocol - WASM Covenant/Escrow Module
//! 
//! Full trustless covenant escrow implementation with KIP-17/KIP-20 support
//! All money handling in u64 SOMPI (1 KAS = 100,000,000 sompi)

pub mod covenant_escrow;
pub mod fee_engine;
pub mod autopayout;
pub mod zk_pipeline;
pub mod board_engine;
pub mod backgammon;
pub mod rps;
pub mod coinflip;
pub mod wordduel;

// Re-export commonly used types
pub use covenant_escrow::{
    CovenantEscrow, SpendPath, CovenantSpend, CovenantId,
    create_covenant_escrow, build_settlement_tx, build_cancel_tx,
    build_deadline_tx, build_leave_tx, encode_covenant_id_kip20,
};

pub use fee_engine::FeeEngine;
pub use autopayout::{AutoPayout, UtxoSelector};
pub use board_engine::{BoardEngine, GameState, ValidationResult};

// WASM FFI exports for JavaScript interop
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmCovenantEscrow {
    inner: CovenantEscrow,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmCovenantEscrow {
    #[wasm_bindgen(constructor)]
    pub fn new(match_id: &str, creator_pubkey: &str, network: &str) -> Result<WasmCovenantEscrow, JsValue> {
        let inner = CovenantEscrow::new(match_id, creator_pubkey, network)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(WasmCovenantEscrow { inner })
    }

    #[wasm_bindgen(js_name = getEscrowAddress)]
    pub fn escrow_address(&self) -> String {
        self.inner.escrow_address.clone()
    }

    #[wasm_bindgen(js_name = getRedeemScript)]
    pub fn redeem_script(&self) -> String {
        hex::encode(&self.inner.redeem_script)
    }

    #[wasm_bindgen(js_name = getCovenantId)]
    pub fn covenant_id(&self) -> String {
        self.inner.covenant_id.clone()
    }

    #[wasm_bindgen(js_name = setOpponent)]
    pub fn set_opponent(&mut self, opponent_pubkey: &str) -> Result<(), JsValue> {
        self.inner.set_opponent(opponent_pubkey)
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
