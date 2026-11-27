//! Kişi 2'nin hesapları. Ortak state.rs'e dokunmaz.

use anchor_lang::prelude::*;

pub mod seeds {
    // WithdrawRequest seed'i ortak `constants::WITHDRAW_REQUEST_SEED` ("wreq"):
    // ["wreq", pool, seq (u64 LE)], seq = pool.withdraw_tail.

    /// Kilitli payların durduğu havuz düzeyindeki token hesabı: ["share_escrow", pool].
    /// Mint = ShareMint, authority = Pool PDA. İlk request_withdraw'da oluşturulur.
    pub const SHARE_ESCROW: &[u8] = b"share_escrow";
}

/// `Loan.reserved` (64 bayt, STATE.md'de Kişi 2'ye ayrılmış) içindeki Kişi 2 alanları.
/// Struct ve IDL değişmez; yalnızca baytların anlamı burada tanımlanır.
///
/// | Bayt   | Alan                 | Tip    | Anlam                                              |
/// |--------|----------------------|--------|----------------------------------------------------|
/// | 0..8   | collateral_deducted  | u64 LE | crank'in teminattan kestiği toplam (Late2 adımı)   |
/// | 8..64  | —                    | 0      | boş                                                |
pub mod loan_ext {
    use crate::state::Loan;

    const COLLATERAL_DEDUCTED: core::ops::Range<usize> = 0..8;

    /// CollateralEscrow'dan şimdiye kadar kesilen tutar.
    pub fn collateral_deducted(loan: &Loan) -> u64 {
        let mut b = [0u8; 8];
        b.copy_from_slice(&loan.reserved[COLLATERAL_DEDUCTED]);
        u64::from_le_bytes(b)
    }

    pub fn set_collateral_deducted(loan: &mut Loan, value: u64) {
        loan.reserved[COLLATERAL_DEDUCTED].copy_from_slice(&value.to_le_bytes());
    }
}

/// Tek bir çekim talebi. Paylar `share_escrow`'a kilitlenir; process_withdrawals FIFO sırayla
/// işlem anındaki NAV ile öder, payları yakar ve hesabı kapatır (kira `owner`'a döner).
#[account]
#[derive(InitSpace, Debug)]
pub struct WithdrawRequest {
    pub pool: Pubkey,
    pub owner: Pubkey,
    /// Ödemenin gideceği USDC token hesabı (talep anında sabitlenir).
    pub destination: Pubkey,
    pub seq: u64,
    pub shares: u64,
    pub created_at: i64,
    pub bump: u8,
}
