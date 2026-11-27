//! DONDURULMUŞ HESAP YAPILARI (Kişi 2 ve frontend buna göre yazar).
//! Alan ekleme/silme yalnızca `reserved` içinden yapılır; bu dosyayı değiştirmeden
//! önce `docs/STATE.md` güncellenir ve ekibe haber verilir.
//!
//! Birimler: tutar = micro-USDC (u64), oran = bps (u16), zaman = saniye (i64).

use anchor_lang::prelude::*;

use crate::constants::RESERVED_BYTES;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetType {
    House,
    Vehicle,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PoolStatus {
    Active,
    Paused,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum LoanStatus {
    Pending,
    Approved,
    Rejected,
    Funded,
    Cancelled,
    Active,
    Late1,
    Late2,
    Defaulted,
    Recovered,
    PaidOff,
}

/// Tek karar girdisi: approve_loan(decision, ...)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Decision {
    Approve,
    Reject,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    // --- kimlik ve roller ---
    pub admin: Pubkey,
    pub asset_type: AssetType,
    pub underwriter: Pubkey,
    pub title_agent: Pubkey,
    pub recovery_agent: Pubkey,
    pub usdc_mint: Pubkey,
    /// Açılış ücretinin platform yarısının gideceği USDC hesabı.
    pub platform_treasury: Pubkey,
    pub pool_id: u64,

    // --- değişmez parametreler (create_pool sonrası değişmez) ---
    pub max_ltv_bps: u16,
    pub rate_bps: u16,
    pub term_months: u16,
    pub recovery_coeff_bps: u16,
    pub grace_seconds: i64,
    pub period_seconds: i64,
    pub provision_bps: [u16; 4],
    pub buffer_bps: u16,
    pub brake_late_bps: u16,
    pub brake_reserve_bps: u16,
    pub min_first_loss_bps: u16,
    pub entry_exit_fee_bps: u16,
    pub min_recovery_bps: u16,
    pub title_timeout_seconds: i64,

    // --- sayaçlar (NAV bunlardan hesaplanır, vault bakiyesinden değil) ---
    pub next_loan_id: u64,
    pub idle_cash: u64,
    pub total_outstanding: u64,
    pub late_default_principal: u64,
    pub loss_provision: u64,
    pub first_loss_balance: u64,
    pub reserve_balance: u64,
    /// Fonlanmış ama tescili onaylanmamış kredilerin yedek fon payı. Yalnızca fren
    /// hesabında kullanılır, NAV'a girmez (karar 1).
    pub reserve_pending: u64,
    pub total_shares: u64,
    /// Çekim kuyruğu (Kişi 2).
    pub withdraw_head: u64,
    pub withdraw_tail: u64,
    pub status: PoolStatus,

    // --- bump'lar ---
    pub bump: u8,
    pub vault_bump: u8,
    pub first_loss_bump: u8,
    pub reserve_bump: u8,
    pub share_mint_bump: u8,

    pub reserved: [u8; RESERVED_BYTES],
}

#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub id: u64,
    pub pool: Pubkey,
    pub borrower: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub appraised_value: u64,
    pub principal: u64,
    pub rate_bps: u16,
    pub installment: u64,
    pub remaining_principal: u64,
    pub paid_installments: u16,
    pub missed_installments: u16,
    pub next_due: i64,
    pub status: LoanStatus,

    // --- underwriter'ın zincire imzaladığı alanlar (kişisel veri yok) ---
    pub doc_hash: [u8; 32],
    pub asset_ref_hash: [u8; 32],
    pub value_band: u64,
    pub region_code: u16,
    pub income_ok: bool,
    pub currency_ok: bool,

    // --- risk / gecikme (Kişi 2) ---
    pub provision_amount: u64,
    pub late_fee_accrued: u64,
    pub last_processed_period: u64,

    pub funded_at: i64,
    pub title_deadline: i64,

    pub bump: u8,
    pub escrow_bump: u8,
    pub collateral_bump: u8,

    pub reserved: [u8; RESERVED_BYTES],
}
