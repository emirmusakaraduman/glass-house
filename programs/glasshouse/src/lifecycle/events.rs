//! Kişi 2 event'leri. Frontend (Kişi 3) şeffaflık paneli için bunları okur.
//! Tutarlar micro-USDC; zaman unix sn.

use anchor_lang::prelude::*;

#[event]
pub struct LoanRepaid {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub amount: u64,
    pub late_fee: u64,
    pub interest: u64,
    pub principal: u64,
    pub remaining_principal: u64,
    /// Durum (LoanStatus indeksi) ödeme sonrası.
    pub status: u8,
    pub next_due: i64,
}

#[event]
pub struct LoanPaidOff {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub amount: u64,
    pub collateral_returned: u64,
}

#[event]
pub struct LoanCranked {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub cranker: Pubkey,
    pub old_status: u8,
    pub new_status: u8,
    pub missed_installments: u16,
    pub collateral_used: u64,
    pub provision_amount: u64,
    pub provision_delta: i64,
}

#[event]
pub struct RecoveryRecorded {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub proceeds: u64,
    pub collateral_used: u64,
    pub loss: u64,
    pub first_loss_used: u64,
    pub reserve_used: u64,
    pub senior_loss: u64,
}

#[event]
pub struct WithdrawRequested {
    pub pool: Pubkey,
    pub request: Pubkey,
    pub owner: Pubkey,
    pub seq: u64,
    pub shares: u64,
}

#[event]
pub struct WithdrawProcessed {
    pub pool: Pubkey,
    pub request: Pubkey,
    pub owner: Pubkey,
    pub seq: u64,
    pub shares: u64,
    pub gross: u64,
    pub fee: u64,
    pub net: u64,
}

#[event]
pub struct WithdrawSkipped {
    pub pool: Pubkey,
    pub request: Pubkey,
    pub seq: u64,
}
