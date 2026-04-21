//! htp-rust-backend/src/wasm/fee_engine.rs
//!
//! All fee calculations in u64 SOMPI. 1 KAS = 100_000_000 sompi.
//! No floating point for money. EVER.

use std::string::String;

const SOMPI_PER_KAS: u64 = 100_000_000;
const PROTOCOL_FEE_BPS: u32 = 200; // 2%
const HEDGE_PROTOCOL_FEE_BPS: u32 = 3_000; // 30%
const HEDGE_USER_BPS: u32 = 7_000; // 70%
const NETWORK_FEE_SOMPI: u64 = 10_000; // 0.0001 KAS

pub struct FeeEngine;

impl FeeEngine {
    /// Skill win: pot * 0.98 (2% fee)
    /// Standard: stake * 2 = pot, winner = pot * 0.98
    pub fn skill_win(pot_sompi: u64) -> (u64, u64) {
        let fee = Self::calculate_fee_sompi(pot_sompi, PROTOCOL_FEE_BPS);
        let winner = pot_sompi.saturating_sub(fee);
        (winner, fee)
    }

    /// Event win (standard): stake * odds * 0.98 (2% fee on net winnings)
    /// Returns (winner_net, fee)
    pub fn event_win_std(stake_sompi: u64, odds_num: u64, odds_den: u64) -> (u64, u64) {
        if odds_den == 0 { return (0, 0); }
        let gross = stake_sompi.saturating_mul(odds_num).wrapping_div(odds_den);
        let net_win = if gross > stake_sompi { gross - stake_sompi } else { 0 };
        let fee = Self::calculate_fee_sompi(net_win, PROTOCOL_FEE_BPS);
        let winner_total = gross.saturating_sub(fee);
        (winner_total, fee)
    }

    /// Event win (maximizer): actual_bet * odds * 0.98
    /// actual_bet = stake * 2 (50 pool + 50 hedge)
    pub fn event_win_max(actual_bet_sompi: u64, odds_num: u64, odds_den: u64) -> (u64, u64) {
        if odds_den == 0 { return (0, 0); }
        let gross = actual_bet_sompi.saturating_mul(odds_num).wrapping_div(odds_den);
        let fee = Self::calculate_fee_sompi(gross, PROTOCOL_FEE_BPS);
        let winner = gross.saturating_sub(fee);
        (winner, fee)
    }

    /// Hedge claim: hedge_amount * 0.70 to user, 0.30 to protocol
    pub fn hedge_claim(hedge_sompi: u64) -> (u64, u64) {
        let user = hedge_sompi.saturating_mul(7_000).wrapping_div(10_000);
        let fee = hedge_sompi.saturating_sub(user);
        (user, fee)
    }

    /// Cancel pre-join: 100% refund, 0 fee
    pub fn cancel_refund(stake_sompi: u64) -> (u64, u64) {
        (stake_sompi, 0)
    }

    /// Deadline expiry: both refunded, 0 fee
    pub fn deadline_refund(total_sompi: u64) -> (u64, u64) {
        let each = total_sompi / 2;
        let remainder = total_sompi % 2; // dust stays in escrow
        (each + remainder, 0)
    }

    /// Calculate fee in sompi given total and basis points.
    /// Never returns more than total (saturating).
    pub fn calculate_fee_sompi(total: u64, bps: u32) -> u64 {
        let fee = (total as u128).saturating_mul(bps as u128)
            .wrapping_div(10_000);
        core::cmp::min(fee as u64, total)
    }

    pub fn winner_payout_sompi(total: u64, bps: u32) -> u64 {
        let fee = Self::calculate_fee_sompi(total, bps);
        total.saturating_sub(fee)
    }

    /// Convert float KAS to u64 sompi. Input should be validated.
    pub fn kas_to_sompi(kas: &str) -> Result<u64, String> {
        let parts: Vec<&str> = kas.split('.').collect();
        let whole: u64 = parts[0].parse::<u64>().map_err(|e| e.to_string())?;
        let frac_val = if parts.len() > 1 {
            let f = parts[1];
            let padded = format!("{:0<8}", f);
            let frac: u64 = padded[..8].parse::<u64>().map_err(|e| e.to_string())?;
            frac
        } else { 0 };
        Ok(whole.saturating_mul(SOMPI_PER_KAS).saturating_add(frac_val))
    }

    /// Format sompi as KAS string with 8 decimals.
    pub fn sompi_to_kas_str(sompi: u64) -> String {
        let whole = sompi / SOMPI_PER_KAS;
        let frac = sompi % SOMPI_PER_KAS;
        format!("{}.{:08}", whole, frac)
    }

    pub fn network_fee_sompi() -> u64 { NETWORK_FEE_SOMPI }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skill_win() {
        let pot = 200 * SOMPI_PER_KAS; // 200 KAS pot (100 + 100)
        let (winner, fee) = FeeEngine::skill_win(pot);
        assert_eq!(fee, 4 * SOMPI_PER_KAS); // 2% of 200 KAS = 4 KAS
        assert_eq!(winner, 196 * SOMPI_PER_KAS);
    }

    #[test]
    fn test_event_win_std() {
        let stake = 100 * SOMPI_PER_KAS;
        let (gross, fee) = FeeEngine::event_win_std(stake, 15, 10); // 1.5x odds
        // gross = 150 KAS. net_win = 50 KAS. fee = 1 KAS. winner_total = 149 KAS
        assert_eq!(fee, 1 * SOMPI_PER_KAS);
        assert_eq!(gross, 149 * SOMPI_PER_KAS);
    }

    #[test]
    fn test_hedge_claim() {
        let hedge = 50 * SOMPI_PER_KAS;
        let (user, fee) = FeeEngine::hedge_claim(hedge);
        assert_eq!(user, 35 * SOMPI_PER_KAS);
        assert_eq!(fee, 15 * SOMPI_PER_KAS);
    }

    #[test]
    fn test_kas_to_sompi() {
        assert_eq!(FeeEngine::kas_to_sompi("1.5").unwrap(), 150_000_000);
        assert_eq!(FeeEngine::kas_to_sompi("0.0001").unwrap(), 10_000);
    }
}
