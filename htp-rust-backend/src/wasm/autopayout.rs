//! htp-rust-backend/src/wasm/autopayout.rs
//!
//! Transaction construction: UTXO selection, outputs, signing placeholders, serialization.

use std::vec::Vec;
use std::string::String;
use blake2::{Blake2b, Digest};
use blake2::digest::consts::U32;
use sha2::{Sha256, Digest as _};

use crate::wasm::fee_engine::FeeEngine;

#[derive(Clone)]
pub struct Utxo {
    pub tx_id: String,
    pub vout: u32,
    pub amount: u64,
    pub script_pubkey: Vec<u8>,
}

pub struct UtxoSelector;

impl UtxoSelector {
    /// Select UTXOs to reach target amount + fee buffer.
    /// Returns selected + change amount.
    pub fn select(
        available: &[Utxo],
        target: u64,
        fee_buffer: u64,
    ) -> Result<(Vec<Utxo>, u64), String> {
        let total_needed = target.saturating_add(fee_buffer);
        let mut selected = Vec::new();
        let mut sum = 0u64;

        // Greedy: sort by largest first to minimize UTXO count
        let mut sorted: Vec<Utxo> = available.iter().cloned().collect();
        sorted.sort_by(|a, b| b.amount.cmp(&a.amount));

        for utxo in sorted {
            if sum >= total_needed { break; }
            sum += utxo.amount;
            selected.push(utxo);
        }

        if sum < total_needed {
            return Err("insufficient UTXOs".into());
        }

        let change = sum - total_needed;
        Ok((selected, change))
    }
}

pub struct AutoPayout;

impl AutoPayout {
    /// Build a raw transaction structure (placeholder for full Kaspa TX format).
    /// Returns (tx_id_hex, tx_bytes_vec).
    pub fn build_tx(
        inputs: &[Utxo],
        outputs: &[(u64, String)], // (amount_sompi, address)
        lock_time: u64,
    ) -> Result<(String, Vec<u8>), String> {
        let mut tx = Vec::new();
        // version
        tx.extend_from_slice(&0u32.to_le_bytes());
        // input count
        tx.push(inputs.len() as u8);
        for inp in inputs {
            let txid = Self::hex_decode(&inp.tx_id)?;
            tx.extend_from_slice(&txid);
            tx.extend_from_slice(&inp.vout.to_le_bytes());
        }
        // output count
        tx.push(outputs.len() as u8);
        for (amt, addr) in outputs {
            tx.extend_from_slice(&amt.to_le_bytes());
            tx.extend_from_slice(addr.as_bytes());
        }
        tx.extend_from_slice(&lock_time.to_le_bytes());

        let h1: [u8; 32] = Sha256::digest(&tx).into();
        let tx_id = hex::encode(Sha256::digest(h1));
        Ok((tx_id, tx))
    }

    /// Skill game settlement TX: inputs -> winner + fee
    pub fn skill_payout(
        inputs: &[Utxo],
        winner_address: &str,
        fee_address: &str,
        network_fee: u64,
    ) -> Result<(String, Vec<u8>), String> {
        let total: u64 = inputs.iter().map(|u| u.amount).sum();
        let spendable = total.saturating_sub(network_fee);
        let (winner, fee) = FeeEngine::skill_win(spendable);
        Self::build_tx(
            inputs,
            &[(winner, winner_address.into()), (fee, fee_address.into())],
            0,
        )
    }

    /// Event standard payout TX
    pub fn event_std_payout(
        inputs: &[Utxo],
        winner_address: &str,
        fee_address: &str,
        stake_sompi: u64,
        odds_num: u64,
        odds_den: u64,
        network_fee: u64,
    ) -> Result<(String, Vec<u8>), String> {
        let (winner, fee) = FeeEngine::event_win_std(stake_sompi, odds_num, odds_den);
        Self::build_tx(
            inputs,
            &[(winner, winner_address.into()), (fee, fee_address.into())],
            0,
        )
    }

    /// Event maximizer payout TX
    pub fn event_max_payout(
        inputs: &[Utxo],
        actual_bet_sompi: u64,
        winner_address: &str,
        fee_address: &str,
        odds_num: u64,
        odds_den: u64,
        network_fee: u64,
    ) -> Result<(String, Vec<u8>), String> {
        let total: u64 = inputs.iter().map(|u| u.amount).sum();
        let _spendable = total.saturating_sub(network_fee);
        let (winner, fee) = FeeEngine::event_win_max(actual_bet_sompi, odds_num, odds_den);
        Self::build_tx(
            inputs,
            &[(winner, winner_address.into()), (fee, fee_address.into())],
            0,
        )
    }

    /// Hedge claim TX: 70% user, 30% protocol
    pub fn hedge_payout(
        inputs: &[Utxo],
        user_address: &str,
        fee_address: &str,
        network_fee: u64,
    ) -> Result<(String, Vec<u8>), String> {
        let total: u64 = inputs.iter().map(|u| u.amount).sum();
        let spendable = total.saturating_sub(network_fee);
        let (user, fee) = FeeEngine::hedge_claim(spendable);
        Self::build_tx(
            inputs,
            &[(user, user_address.into()), (fee, fee_address.into())],
            0,
        )
    }

    /// Cancel refund TX
    pub fn cancel_payout(
        inputs: &[Utxo],
        creator_address: &str,
        network_fee: u64,
    ) -> Result<(String, Vec<u8>), String> {
        let total: u64 = inputs.iter().map(|u| u.amount).sum();
        let refund = total.saturating_sub(network_fee);
        Self::build_tx(inputs, &[(refund, creator_address.into())], 0)
    }

    /// Deadline refund TX (split)
    pub fn deadline_payout(
        inputs: &[Utxo],
        creator_address: &str,
        opponent_address: &str,
        network_fee: u64,
    ) -> Result<(String, Vec<u8>), String> {
        let total: u64 = inputs.iter().map(|u| u.amount).sum();
        let spendable = total.saturating_sub(network_fee);
        let half = spendable / 2;
        Self::build_tx(
            inputs,
            &[
                (half, creator_address.into()),
                (spendable - half, opponent_address.into()),
            ],
            0,
        )
    }

    fn hex_decode(h: &str) -> Result<Vec<u8>, String> {
        if h.len() % 2 != 0 { return Err("odd hex".into()); }
        let mut out = Vec::with_capacity(h.len() / 2);
        for i in (0..h.len()).step_by(2) {
            out.push(u8::from_str_radix(&h[i..i+2], 16).map_err(|e| e.to_string())?);
        }
        Ok(out)
    }
}
