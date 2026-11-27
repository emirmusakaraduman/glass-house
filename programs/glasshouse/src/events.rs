//! Frontend bu event'leri okur. Zincire kişisel veri yazılmaz: yalnızca adresler,
//! tutarlar, bantlar ve hash'ler.

use anchor_lang::prelude::*;

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub admin: Pubkey,
    pub asset_type: u8,
    pub max_ltv_bps: u16,
    pub rate_bps: u16,
    pub term_months: u16,
}

#[event]
pub struct FirstLossFunded {
    pub pool: Pubkey,
    pub amount: u64,
    pub first_loss_balance: u64,
}

#[event]
pub struct Deposited {
    pub pool: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub shares_minted: u64,
    pub total_shares: u64,
    pub senior_nav: u64,
}

#[event]
pub struct LoanApplied {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub borrower: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub principal: u64,
    pub installment: u64,
    pub escrow_amount: u64,
    pub collateral_amount: u64,
}

#[event]
pub struct LoanApproved {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub appraised_value: u64,
    pub value_band: u64,
    pub region_code: u16,
    pub doc_hash: [u8; 32],
    pub asset_ref_hash: [u8; 32],
}

#[event]
pub struct LoanRejected {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub refunded: u64,
}

#[event]
pub struct LoanFunded {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub principal: u64,
    pub title_deadline: i64,
    pub idle_cash: u64,
    pub total_outstanding: u64,
    pub reserve_pending: u64,
}

#[event]
pub struct TitleConfirmed {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub paid_to_seller: u64,
    pub reserve_balance: u64,
    pub next_due: i64,
}

#[event]
pub struct FundingCancelled {
    pub pool: Pubkey,
    pub loan: Pubkey,
    pub loan_id: u64,
    pub returned_to_vault: u64,
}
