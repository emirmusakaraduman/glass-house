//! NAV, pay fiyatı ve invariant'lar.
//!
//! NAV içsel sayaçlardan hesaplanır, vault token bakiyesinden DEĞİL: havuza doğrudan
//! USDC bağışlayarak pay fiyatı şişirilemez. Ek olarak pay basımında sanal ofset var.
//!
//! Yuvarlama: yatırımcıya verilen pay/USDC aşağı, alınan ücret yukarı.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GlassError;
use crate::math::{mul_div, mul_div_up, origination_fee};
use crate::state::{LoanStatus, Pool};

fn to_u64(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| error!(GlassError::MathOverflow))
}

// ---------------------------------------------------------------- NAV

/// senior_nav = idle_cash + total_outstanding − max(0, loss_provision − first_loss − reserve).
/// `reserve_pending` NAV'a girmez (karar 1).
pub fn senior_nav(
    idle_cash: u64,
    total_outstanding: u64,
    loss_provision: u64,
    first_loss_balance: u64,
    reserve_balance: u64,
) -> Result<u64> {
    let gross = (idle_cash as u128)
        .checked_add(total_outstanding as u128)
        .ok_or_else(|| error!(GlassError::MathOverflow))?;
    let shortfall = (loss_provision as u128)
        .saturating_sub(first_loss_balance as u128)
        .saturating_sub(reserve_balance as u128);
    to_u64(gross.saturating_sub(shortfall))
}

pub fn pool_senior_nav(pool: &Pool) -> Result<u64> {
    senior_nav(
        pool.idle_cash,
        pool.total_outstanding,
        pool.loss_provision,
        pool.first_loss_balance,
        pool.reserve_balance,
    )
}

// ---------------------------------------------------------------- pay modülü

/// Pay fiyatı, 1e18 ölçekli (USDC başına pay değil: pay başına micro-USDC × 1e18/1e6 değil,
/// oran). İlk durumda (0 pay, 0 NAV) tam 1,0 = SCALE.
pub fn share_price(nav: u64, total_shares: u64) -> Result<u128> {
    mul_div(
        nav as u128 + VIRTUAL_ASSETS,
        SCALE,
        total_shares as u128 + VIRTUAL_SHARES,
    )
}

/// Yatırılan (ücret sonrası) USDC karşılığı basılacak pay; aşağı yuvarlanır.
/// `nav`, yatırımdan ÖNCEKİ senior_nav'dır.
pub fn shares_for_deposit(net_assets: u64, total_shares: u64, nav: u64) -> Result<u64> {
    to_u64(mul_div(
        net_assets as u128,
        total_shares as u128 + VIRTUAL_SHARES,
        nav as u128 + VIRTUAL_ASSETS,
    )?)
}

/// Yakılan pay karşılığı brüt USDC; aşağı yuvarlanır.
pub fn assets_for_shares(shares: u64, total_shares: u64, nav: u64) -> Result<u64> {
    to_u64(mul_div(
        shares as u128,
        nav as u128 + VIRTUAL_ASSETS,
        total_shares as u128 + VIRTUAL_SHARES,
    )?)
}

/// Giriş/çıkış ücreti: yukarı yuvarlanır. Ücret havuzda kalır (idle_cash'e girer,
/// mevcut payların değerini artırır).
pub fn entry_exit_fee(amount: u64, fee_bps: u16) -> Result<u64> {
    to_u64(mul_div_up(amount as u128, fee_bps as u128, BPS_DENOM as u128)?)
}

/// Yatırım: (ücret, basılacak pay). Tutarın tamamı idle_cash'e girer.
pub fn deposit_quote(
    amount: u64,
    fee_bps: u16,
    total_shares: u64,
    nav: u64,
) -> Result<(u64, u64)> {
    if amount == 0 {
        return err!(GlassError::ZeroAmount);
    }
    let fee = entry_exit_fee(amount, fee_bps)?;
    let net = amount - fee.min(amount);
    let shares = shares_for_deposit(net, total_shares, nav)?;
    Ok((fee, shares))
}

/// Çekim: (brüt, ücret, net). Kişi 2'nin request_withdraw / process_withdrawals'ı kullanır.
pub fn withdraw_quote(
    shares: u64,
    fee_bps: u16,
    total_shares: u64,
    nav: u64,
) -> Result<(u64, u64, u64)> {
    if shares == 0 {
        return err!(GlassError::ZeroAmount);
    }
    let gross = assets_for_shares(shares, total_shares, nav)?;
    let fee = entry_exit_fee(gross, fee_bps)?.min(gross);
    Ok((gross, fee, gross - fee))
}

// ---------------------------------------------------------------- invariant'lar

/// vault.amount ≥ pool.idle_cash (vault'a doğrudan bağış fazlalık yaratır, açık yaratmaz).
pub fn assert_vault_covers_idle(vault_amount: u64, idle_cash: u64) -> Result<()> {
    require!(vault_amount >= idle_cash, GlassError::InvariantViolation);
    Ok(())
}

/// LoanEscrow'da durum gereği bulunması gereken tutar.
/// Pending/Approved: peşinat + ücret. Funded: fiyat + ücret (peşinat + anapara + ücret).
/// Diğer durumlarda hesap kapalı ya da boş (0).
pub fn loan_escrow_expected(status: LoanStatus, price: u64, principal: u64) -> Result<u64> {
    let fee = origination_fee(principal)?;
    let down = price
        .checked_sub(principal)
        .ok_or_else(|| error!(GlassError::MathOverflow))?;
    let v = match status {
        LoanStatus::Pending | LoanStatus::Approved => down as u128 + fee as u128,
        LoanStatus::Funded => price as u128 + fee as u128,
        _ => 0,
    };
    to_u64(v)
}

/// Escrow token bakiyesi ≥ kredinin sayaçlarından beklenen tutar.
/// Eşitlik DEĞİL: token hesabına herkes imzasız transfer yapabilir; eşitlik kontrolü,
/// 1 micro-USDC bağışla krediyi (iade dahil) kilitlemeye yol açardı. Fazlalık güvenlidir
/// ve iade/iptalde borçluya gider.
pub fn assert_escrow_covers(escrow_amount: u64, expected: u64) -> Result<()> {
    require!(escrow_amount >= expected, GlassError::InvariantViolation);
    Ok(())
}

// ---------------------------------------------------------------- testler

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    #[test]
    fn nav_ignores_vault_and_pending() {
        // zarar karşılığı first_loss + reserve içinde kalıyorsa NAV düşmez
        assert_eq!(
            senior_nav(100 * USDC, 900 * USDC, 40 * USDC, 30 * USDC, 10 * USDC).unwrap(),
            1_000 * USDC
        );
        // aşan kısım NAV'dan düşer
        assert_eq!(
            senior_nav(100 * USDC, 900 * USDC, 50 * USDC, 30 * USDC, 10 * USDC).unwrap(),
            990 * USDC
        );
        // NAV sıfırın altına inmez
        assert_eq!(senior_nav(0, 10, 1_000, 0, 0).unwrap(), 0);
    }

    #[test]
    fn first_deposit_is_one_to_one_price() {
        assert_eq!(share_price(0, 0).unwrap(), SCALE);
        let (fee, shares) = deposit_quote(1_000 * USDC, 0, 0, 0).unwrap();
        assert_eq!(fee, 0);
        assert_eq!(shares, 1_000 * USDC);
        assert_eq!(share_price(1_000 * USDC, shares).unwrap(), SCALE);
    }

    #[test]
    fn price_stays_constant_across_two_depositors() {
        let (_, s1) = deposit_quote(1_000 * USDC, 0, 0, 0).unwrap();
        let nav1 = 1_000 * USDC;
        let p1 = share_price(nav1, s1).unwrap();
        let (_, s2) = deposit_quote(500 * USDC, 0, s1, nav1).unwrap();
        let nav2 = nav1 + 500 * USDC;
        let p2 = share_price(nav2, s1 + s2).unwrap();
        assert_eq!(p1, p2);
        // 1:1
        assert_eq!(s2, 500 * USDC);
    }

    #[test]
    fn price_grows_with_accrued_interest() {
        let (_, s1) = deposit_quote(1_000 * USDC, 0, 0, 0).unwrap();
        // havuza 10 USDC faiz girdi → NAV 1010
        let nav = 1_010 * USDC;
        assert!(share_price(nav, s1).unwrap() > SCALE);
        // sonraki yatırımcı daha az pay alır
        let (_, s2) = deposit_quote(1_000 * USDC, 0, s1, nav).unwrap();
        assert!(s2 < 1_000 * USDC);
        // ve aldığı payın değeri yatırdığından fazla olamaz (aşağı yuvarlama)
        let back = assets_for_shares(s2, s1 + s2, nav + 1_000 * USDC).unwrap();
        assert!(back <= 1_000 * USDC);
    }

    #[test]
    fn donation_attack_does_not_steal_deposit() {
        // Saldırgan 1 micro-USDC yatırır; ardından vault'a 1_000 USDC bağışlar.
        // NAV sayaçlardan hesaplandığı için bağış NAV'ı etkilemez.
        let (_, attacker_shares) = deposit_quote(1, 0, 0, 0).unwrap();
        let nav = 1; // idle_cash = 1; bağış sayaçlara girmez
        let (_, victim_shares) = deposit_quote(1_000 * USDC, 0, attacker_shares, nav).unwrap();
        assert!(victim_shares > 0);
        // mağdurun payının değeri yatırdığına çok yakın kalır
        let value = assets_for_shares(
            victim_shares,
            attacker_shares + victim_shares,
            nav + 1_000 * USDC,
        )
        .unwrap();
        assert!(value >= 1_000 * USDC - 2);
    }

    #[test]
    fn inflation_attack_even_if_nav_were_donated() {
        // Sanal ofset tek başına da korur: NAV 1_000 USDC şişirilse bile
        // 1 micro payı olan saldırgan mağdurun payını sıfıra yuvarlayamaz.
        let (_, attacker_shares) = deposit_quote(1, 0, 0, 0).unwrap();
        let inflated_nav = 1_000 * USDC;
        let (_, victim_shares) =
            deposit_quote(1_000 * USDC, 0, attacker_shares, inflated_nav).unwrap();
        assert!(victim_shares > 0, "pay sıfıra yuvarlandı");
    }

    #[test]
    fn entry_exit_fee_rounds_up_and_stays_in_pool() {
        // %0,2 giriş ücreti
        let (fee, shares) = deposit_quote(1_000 * USDC, 20, 0, 0).unwrap();
        assert_eq!(fee, 2 * USDC);
        assert_eq!(shares, 998 * USDC);
        // 1 micro üzerinde bile yukarı yuvarlanır
        assert_eq!(entry_exit_fee(1, 20).unwrap(), 1);
        // çıkış
        let (gross, fee, net) = withdraw_quote(shares, 20, shares, 1_000 * USDC).unwrap();
        assert_eq!(gross - fee, net);
        assert!(net < 1_000 * USDC);
    }

    #[test]
    fn zero_amounts_rejected() {
        assert!(deposit_quote(0, 20, 0, 0).is_err());
        assert!(withdraw_quote(0, 20, 10, 10).is_err());
    }

    #[test]
    fn vault_invariant() {
        assert!(assert_vault_covers_idle(100, 100).is_ok());
        assert!(assert_vault_covers_idle(150, 100).is_ok()); // bağış fazlalığı serbest
        assert!(assert_vault_covers_idle(99, 100).is_err());
    }

    #[test]
    fn loan_escrow_expectations_follow_status() {
        let price = 100_000 * USDC;
        let principal = 70_000 * USDC;
        assert_eq!(
            loan_escrow_expected(LoanStatus::Pending, price, principal).unwrap(),
            30_700 * USDC
        );
        assert_eq!(
            loan_escrow_expected(LoanStatus::Approved, price, principal).unwrap(),
            30_700 * USDC
        );
        assert_eq!(
            loan_escrow_expected(LoanStatus::Funded, price, principal).unwrap(),
            100_700 * USDC
        );
        assert_eq!(
            loan_escrow_expected(LoanStatus::Active, price, principal).unwrap(),
            0
        );
        assert!(assert_escrow_covers(30_700 * USDC, 30_700 * USDC).is_ok());
        assert!(assert_escrow_covers(1, 2).is_err());
        // bağış fazlalık yaratır, açık değil
        assert!(assert_escrow_covers(30_700 * USDC + 1, 30_700 * USDC).is_ok());
    }
}
