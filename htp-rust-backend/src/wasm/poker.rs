//! htp-rust-backend/src/wasm/poker.rs
//!
//! 5-card hand evaluator for Texas Hold'em (2 players).
//! All money in u64 SOMPI. No floats.

use std::vec::Vec;
use std::string::String;

const PROTOCOL_FEE_BPS: u64 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum HandRank {
    HighCard = 0,
    OnePair = 1,
    TwoPair = 2,
    ThreeOfAKind = 3,
    Straight = 4,
    Flush = 5,
    FullHouse = 6,
    FourOfAKind = 7,
    StraightFlush = 8,
    RoyalFlush = 9,
}

#[derive(Debug, Clone, Copy)]
pub struct Card {
    pub rank: u8, // 2-14 (14 = Ace)
    pub suit: u8, // 0-3
}

impl Card {
    pub fn new(rank: u8, suit: u8) -> Self {
        Card { rank: rank.clamp(2, 14), suit: suit & 3 }
    }
}

/// Evaluate a 5-card hand. Returns (HandRank, tiebreaker_score).
pub fn eval_five(cards: [Card; 5]) -> (HandRank, u32) {
    let mut ranks: Vec<u8> = cards.iter().map(|c| c.rank).collect();
    ranks.sort_unstable();
    let is_flush = cards.iter().all(|c| c.suit == cards[0].suit);
    let is_straight = {
        if ranks[4] == 14 && ranks[0] == 2 && ranks[1] == 3 && ranks[2] == 4 && ranks[3] == 5 {
            true // Ace-low
        } else {
            ranks.windows(2).all(|w| w[1] == w[0] + 1)
        }
    };
    let mut counts = [0u8; 15];
    for r in &ranks { counts[*r as usize] += 1; }
    let mut pairs: Vec<u8> = Vec::new();
    let mut trips: Vec<u8> = Vec::new();
    let mut quads: Vec<u8> = Vec::new();
    for (rank, count) in counts.iter().enumerate() {
        if *count == 2 { pairs.push(rank as u8); }
        if *count == 3 { trips.push(rank as u8); }
        if *count == 4 { quads.push(rank as u8); }
    }
    pairs.sort_unstable_by(|a, b| b.cmp(a));
    trips.sort_unstable_by(|a, b| b.cmp(a));

    let base_score = |hr: HandRank| -> u32 {
        let mut score = (hr as u32) * 1_000_000;
        for (idx, r) in ranks.iter().rev().enumerate() {
            if ranks[4] == 14 && ranks[0] == 2 && is_straight && (hr == HandRank::Straight || hr == HandRank::StraightFlush) {
                let adj = [5u8, 4, 3, 2, 14];
                for (i, ar) in adj.iter().rev().enumerate() {
                    score |= (*ar as u32) << (i * 4);
                }
                return score;
            }
            score |= (*r as u32) << (idx * 4);
        }
        score
    };

    if is_flush && is_straight {
        if ranks.contains(&14) && ranks.contains(&13) {
            return (HandRank::RoyalFlush, base_score(HandRank::RoyalFlush));
        }
        return (HandRank::StraightFlush, base_score(HandRank::StraightFlush));
    }
    if !quads.is_empty() {
        let mut score = base_score(HandRank::FourOfAKind);
        score &= 0xFFF0_0000;
        score |= (quads[0] as u32) << 16;
        let kicker = ranks.iter().find(|r| **r != quads[0]).unwrap_or(&0);
        score |= (*kicker as u32);
        return (HandRank::FourOfAKind, score);
    }
    if !trips.is_empty() && !pairs.is_empty() {
        let mut score = base_score(HandRank::FullHouse);
        score &= 0xFFF0_0000;
        score |= (trips[0] as u32) << 16 | (pairs[0] as u32) << 12;
        return (HandRank::FullHouse, score);
    }
    if is_flush { return (HandRank::Flush, base_score(HandRank::Flush)); }
    if is_straight { return (HandRank::Straight, base_score(HandRank::Straight)); }
    if !trips.is_empty() {
        let mut score = base_score(HandRank::ThreeOfAKind);
        score &= 0xFFF0_0000;
        score |= (trips[0] as u32) << 16;
        let kickers: Vec<u8> = ranks.iter().filter(|r| **r != trips[0]).cloned().collect();
        for (i, k) in kickers.iter().rev().enumerate() { score |= (*k as u32) << (12 - i * 4); }
        return (HandRank::ThreeOfAKind, score);
    }
    if pairs.len() >= 2 {
        let mut score = base_score(HandRank::TwoPair);
        score &= 0xFFF0_0000;
        score |= (pairs[0] as u32) << 16 | (pairs[1] as u32) << 12;
        let kicker = ranks.iter().find(|r| **r != pairs[0] && **r != pairs[1]).unwrap_or(&0);
        score |= (*kicker as u32) << 8;
        return (HandRank::TwoPair, score);
    }
    if !pairs.is_empty() {
        let mut score = base_score(HandRank::OnePair);
        score &= 0xFFF0_0000;
        score |= (pairs[0] as u32) << 16;
        let kickers: Vec<u8> = ranks.iter().filter(|r| **r != pairs[0]).cloned().collect();
        for (i, k) in kickers.iter().rev().enumerate() { score |= (*k as u32) << (12 - i * 4); }
        return (HandRank::OnePair, score);
    }
    (HandRank::HighCard, base_score(HandRank::HighCard))
}

/// Evaluate best 5-card hand from 7 cards.
pub fn eval_seven(cards: &[Card]) -> (HandRank, u32) {
    let mut best = (HandRank::HighCard, 0u32);
    if cards.len() < 5 { return best; }
    let n = cards.len();
    for a in 0..n {
        for b in a+1..n {
            for c in b+1..n {
                for d in c+1..n {
                    for e in d+1..n {
                        let five = [cards[a].clone(), cards[b].clone(), cards[c].clone(), cards[d].clone(), cards[e].clone()];
                        let score = eval_five(five);
                        if score > best { best = score; }
                    }
                }
            }
        }
    }
    best
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum GameState {
    WaitingForPlayers = 0,
    Dealing = 1,
    PreFlop = 2,
    Flop = 3,
    Turn = 4,
    River = 5,
    Showdown = 6,
    Complete = 7,
}

pub struct PokerGame {
    pub state: GameState,
    pub deck: Vec<Card>,
    pub deck_idx: usize,
    pub hole0: Vec<Card>,
    pub hole1: Vec<Card>,
    pub community: Vec<Card>,
    pub pot: u64,
    pub side_pot: u64,
    pub bets: [u64; 2],
    pub folded: [bool; 2],
    pub stake_sompi: u64,
    pub winner: Option<u8>,
}

impl PokerGame {
    pub fn new(seed: u64) -> PokerGame {
        let mut deck = Vec::with_capacity(52);
        for s in 0..4 { for r in 2..=14 { deck.push(Card::new(r, s)); } }
        let mut next = seed;
        for i in (1..52).rev() {
            next = next.wrapping_mul(1103515245).wrapping_add(12345);
            let j = (next % (i as u64 + 1)) as usize;
            deck.swap(i, j);
        }
        PokerGame {
            state: GameState::WaitingForPlayers,
            deck, deck_idx: 0,
            hole0: Vec::new(), hole1: Vec::new(),
            community: Vec::new(),
            pot: 0, side_pot: 0,
            bets: [0, 0], folded: [false, false],
            stake_sompi: 0,
            winner: None,
        }
    }

    pub fn place_bet(&mut self, player: u8, amount_sompi: u64) {
        if self.state == GameState::Complete || self.state == GameState::WaitingForPlayers { return; }
        let p = if player == 0 { 0 } else { 1 };
        self.bets[p] += amount_sompi;
        self.pot += amount_sompi;
    }

    pub fn fold(&mut self, player: u8) {
        let p = if player == 0 { 0 } else { 1 };
        self.folded[p] = true;
        self.winner = Some((1 - p) as u8);
        self.state = GameState::Complete;
    }

    pub fn call(&mut self, player: u8) {
        let p = if player == 0 { 0 } else { 1 };
        let other = 1 - p;
        let diff = self.bets[other].saturating_sub(self.bets[p]);
        if diff > 0 { self.place_bet(player, diff); }
    }

    pub fn start_game(&mut self, stake_sompi: u64) {
        self.stake_sompi = stake_sompi;
        self.state = GameState::Dealing;
        self.hole0.clear(); self.hole1.clear(); self.community.clear();
        self.hole0.push(self.deck[self.deck_idx]); self.deck_idx += 1;
        self.hole1.push(self.deck[self.deck_idx]); self.deck_idx += 1;
        self.hole0.push(self.deck[self.deck_idx]); self.deck_idx += 1;
        self.hole1.push(self.deck[self.deck_idx]); self.deck_idx += 1;
        self.bets = [0, 0];
        self.folded = [false, false];
        self.pot = 0;
        self.side_pot = 0;
        self.winner = None;
        self.state = GameState::PreFlop;
    }

    pub fn deal_flop(&mut self) {
        if (self.state as u8) < (GameState::PreFlop as u8) { return; }
        self.community.push(self.deck[self.deck_idx]); self.deck_idx += 1;
        self.community.push(self.deck[self.deck_idx]); self.deck_idx += 1;
        self.community.push(self.deck[self.deck_idx]); self.deck_idx += 1;
        self.state = GameState::Flop;
    }

    pub fn deal_turn(&mut self) {
        if (self.state as u8) < (GameState::Flop as u8) { return; }
        self.community.push(self.deck[self.deck_idx]); self.deck_idx += 1;
        self.state = GameState::Turn;
    }

    pub fn deal_river(&mut self) {
        if (self.state as u8) < (GameState::Turn as u8) { return; }
        self.community.push(self.deck[self.deck_idx]); self.deck_idx += 1;
        self.state = GameState::River;
    }

    pub fn do_showdown(&mut self) {
        if self.folded[0] { self.winner = Some(1); self.state = GameState::Complete; return; }
        if self.folded[1] { self.winner = Some(0); self.state = GameState::Complete; return; }
        let mut c0 = self.hole0.clone(); c0.extend(self.community.clone());
        let mut c1 = self.hole1.clone(); c1.extend(self.community.clone());
        let s0 = eval_seven(&c0);
        let s1 = eval_seven(&c1);
        if s0 > s1 { self.winner = Some(0); }
        else if s1 > s0 { self.winner = Some(1); }
        else { self.winner = Some(0); }
        self.state = GameState::Showdown;
    }

    pub fn get_state_json(&self) -> String {
        format!(
            "{{\"state\":{},\"pot\":{},\"side_pot\":{},\"bets\":[{},{}],\"folded\":[{},{}],\"winner\":{}}}",
            self.state as u8, self.pot, self.side_pot,
            self.bets[0], self.bets[1],
            self.folded[0], self.folded[1],
            opt_u8(self.winner)
        )
    }

    pub fn get_payout_sompi(&self) -> u64 {
        if self.pot == 0 { return 0; }
        let fee = self.pot * PROTOCOL_FEE_BPS / 10_000;
        self.pot - fee
    }

    pub fn get_fee_sompi(&self) -> u64 {
        if self.pot == 0 { return 0; }
        self.pot * PROTOCOL_FEE_BPS / 10_000
    }

    pub fn get_hole_cards_json(&self) -> String {
        format!("[{},{}]", cards_json(&self.hole0), cards_json(&self.hole1))
    }

    pub fn get_community_json(&self) -> String { cards_json(&self.community) }
}

fn opt_u8(v: Option<u8>) -> String {
    match v { Some(n) => n.to_string(), None => "null".into() }
}

fn cards_json(cards: &Vec<Card>) -> String {
    let mut s = String::from("[");
    for (i, c) in cards.iter().enumerate() {
        if i > 0 { s.push(','); }
        s.push_str(&format!("{{\"rank\":{},\"suit\":{}}}", c.rank, c.suit));
    }
    s.push(']');
    s
}
