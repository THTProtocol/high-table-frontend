//! htp-rust-backend/src/wasm/blackjack.rs
//!
//! Blackjack engine: player vs dealer. All money in u64 SOMPI.

use std::vec::Vec;
use std::string::String;

const PROTOCOL_FEE_BPS: u64 = 200;

#[derive(Clone, Copy, Debug)]
pub struct BCard {
    pub suit: u8, // 0-3
    pub rank: u8, // 1-13 (1=Ace, 11=J, 12=Q, 13=K)
}

impl BCard {
    pub fn value(&self) -> u8 {
        match self.rank {
            1 => 11, // Ace
            11 | 12 | 13 => 10,
            _ => self.rank,
        }
    }
    pub fn display_rank(&self) -> String {
        match self.rank {
            1 => "A".into(),
            11 => "J".into(),
            12 => "Q".into(),
            13 => "K".into(),
            _ => self.rank.to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[repr(u8)]
pub enum BJState {
    WaitingForBet = 0,
    PlayerTurn = 1,
    DealerTurn = 2,
    Complete = 3,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BJResult {
    PlayerWin,
    DealerWin,
    Push,
    PlayerBlackjack,
}

pub struct BlackjackGame {
    pub state: BJState,
    pub deck: Vec<BCard>,
    pub deck_idx: usize,
    pub player_hand: Vec<BCard>,
    pub dealer_hand: Vec<BCard>,
    pub bet_sompi: u64,
    pub player_done: bool,
    pub result: Option<BJResult>,
}

impl BlackjackGame {
    pub fn new(seed: u64) -> BlackjackGame {
        let mut deck = Vec::with_capacity(52);
        for s in 0..4 { for r in 1..=13 { deck.push(BCard { suit: s, rank: r }); } }
        let mut next = seed;
        for i in (1..52).rev() {
            next = next.wrapping_mul(1103515245).wrapping_add(12345);
            let j = (next % (i as u64 + 1)) as usize;
            deck.swap(i, j);
        }
        BlackjackGame {
            state: BJState::WaitingForBet,
            deck, deck_idx: 0,
            player_hand: Vec::new(), dealer_hand: Vec::new(),
            bet_sompi: 0, player_done: false, result: None,
        }
    }

    pub fn place_bet(&mut self, amount_sompi: u64) {
        if self.state != BJState::WaitingForBet { return; }
        self.bet_sompi = amount_sompi;
    }

    pub fn deal(&mut self) {
        if self.state != BJState::WaitingForBet || self.bet_sompi == 0 { return; }
        self.player_hand.clear(); self.dealer_hand.clear();
        let c1=self.draw(); self.player_hand.push(c1);
        let c2=self.draw(); self.dealer_hand.push(c2);
        let c3=self.draw(); self.player_hand.push(c3);
        let c4=self.draw(); self.dealer_hand.push(c4);
        self.state = BJState::PlayerTurn;
        self.player_done = false;
        self.result = None;
        let phlen=self.player_hand.len(); let phtot=self.hand_total(&self.player_hand);
        if phlen == 2 && phtot == 21 {
            self.player_done = true;
            self.finish_dealer();
        }
    }

    fn draw(&mut self) -> BCard {
        let c = self.deck[self.deck_idx].clone(); self.deck_idx += 1; c
    }

    fn hand_total(&self, hand: &Vec<BCard>) -> u8 {
        let mut total: u8 = hand.iter().map(|c| c.value()).sum();
        let mut aces = hand.iter().filter(|c| c.rank == 1).count() as u8;
        while total > 21 && aces > 0 { total -= 10; aces -= 1; }
        total
    }

    fn is_blackjack(&self, hand: &Vec<BCard>) -> bool {
        hand.len() == 2 && self.hand_total(hand) == 21
    }

    fn is_bust(&self, hand: &Vec<BCard>) -> bool {
        self.hand_total(hand) > 21
    }

    pub fn hit(&mut self) {
        if self.state != BJState::PlayerTurn || self.player_done { return; }
        let card = self.draw(); self.player_hand.push(card);
        let bust = self.is_bust(&self.player_hand);
        if bust {
            self.player_done = true;
            self.state = BJState::Complete;
            self.result = Some(BJResult::DealerWin);
        } else if self.hand_total(&self.player_hand) == 21 {
            self.player_done = true;
        }
    }

    pub fn stand(&mut self) {
        if self.state != BJState::PlayerTurn || self.player_done { return; }
        self.player_done = true;
        self.finish_dealer();
    }

    pub fn double_down(&mut self) {
        if self.state != BJState::PlayerTurn || self.player_done { return; }
        self.bet_sompi *= 2;
        let dd_card = self.draw(); self.player_hand.push(dd_card);
        self.player_done = true;
        let dd_bust = self.hand_total(&self.player_hand) > 21;
        if dd_bust {
            self.state = BJState::Complete;
            self.result = Some(BJResult::DealerWin);
        } else {
            self.finish_dealer();
        }
    }

    fn finish_dealer(&mut self) {
        self.state = BJState::DealerTurn;
        loop {
            let tot = self.hand_total(&self.dealer_hand);
            if tot >= 17 { break; }
            let card = self.draw(); self.dealer_hand.push(card);
        }
        let pt = self.hand_total(&self.player_hand);
        let dt = self.hand_total(&self.dealer_hand);
        let pbj = self.player_hand.len()==2 && pt==21;
        let dbj = self.dealer_hand.len()==2 && dt==21;
        let dbust = self.is_bust(&self.dealer_hand);
        self.result = if pbj && !dbj {
            Some(BJResult::PlayerBlackjack)
        } else if pbj && dbj {
            Some(BJResult::Push)
        } else if dbj {
            Some(BJResult::DealerWin)
        } else if dbust {
            Some(BJResult::PlayerWin)
        } else if pt > dt {
            Some(BJResult::PlayerWin)
        } else if dt > pt {
            Some(BJResult::DealerWin)
        } else {
            Some(BJResult::Push)
        };
        self.state = BJState::Complete;
    }

    pub fn get_state_json(&self) -> String {
        format!(
            "{{\"state\":{},\"bet\":{},\"player_total\":{},\"dealer_total\":{},\"player_done\":{},\"result\":{}}}",
            self.state.clone() as u8, self.bet_sompi,
            { let h=&self.player_hand; self.hand_total(&self.player_hand.clone()) },
            { let h=&self.dealer_hand; self.hand_total(&self.player_hand.clone()) },
            self.player_done,
            bj_result_str(&self.result)
        )
    }

    pub fn get_payout_sompi(&self) -> u64 {
        let net = match self.result {
            Some(BJResult::PlayerBlackjack) => self.bet_sompi.saturating_mul(5).wrapping_div(2),
            Some(BJResult::PlayerWin) => self.bet_sompi.saturating_mul(2),
            Some(BJResult::Push) => self.bet_sompi,
            _ => 0u64,
        };
        if net == 0 { return 0; }
        let fee = net.saturating_mul(PROTOCOL_FEE_BPS).wrapping_div(10_000);
        net.saturating_sub(fee)
    }

    pub fn get_fee_sompi(&self) -> u64 {
        let gross = match self.result {
            Some(BJResult::PlayerBlackjack) => self.bet_sompi.saturating_mul(5).wrapping_div(2),
            Some(BJResult::PlayerWin) => self.bet_sompi.saturating_mul(2),
            Some(BJResult::Push) => self.bet_sompi,
            _ => 0u64,
        };
        if gross == 0 { return 0; }
        gross.saturating_mul(PROTOCOL_FEE_BPS).wrapping_div(10_000)
    }

    pub fn get_winner_label(&self) -> String {
        match self.result {
            Some(BJResult::PlayerBlackjack) => "Blackjack!".into(),
            Some(BJResult::PlayerWin) => "Win!".into(),
            Some(BJResult::DealerWin) => "Dealer wins".into(),
            Some(BJResult::Push) => "Push".into(),
            None => "Playing".into(),
        }
    }

    pub fn can_cancel(&self) -> bool {
        self.state == BJState::WaitingForBet
    }

    pub fn get_player_cards_json(&self) -> String { b_cards_json(&self.player_hand) }
    pub fn get_dealer_cards_json(&self) -> String { b_cards_json(&self.dealer_hand) }
}

fn bj_result_str(r: &Option<BJResult>) -> String {
    match r {
        Some(BJResult::PlayerBlackjack) => "\"blackjack\"".into(),
        Some(BJResult::PlayerWin) => "\"win\"".into(),
        Some(BJResult::DealerWin) => "\"dealer\"".into(),
        Some(BJResult::Push) => "\"push\"".into(),
        None => "null".into(),
    }
}

fn b_cards_json(cards: &Vec<BCard>) -> String {
    let mut s = String::from("[");
    for (i, c) in cards.iter().enumerate() {
        if i > 0 { s.push(','); }
        s.push_str(&format!(
            "{{\"rank\":\"{}\",\"suit\":{},\"value\":{}}}",
            c.display_rank(), c.suit, c.value()
        ));
    }
    s.push(']');
    s
}
