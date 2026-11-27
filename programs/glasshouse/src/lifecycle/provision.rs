//! Karşılık kademeleri — saf fonksiyonlar.
//!
//! `pool.provision_bps = [Active, Late1, Late2, Defaulted taban]` (ürün değeri [0, 500, 1500, 1500];
//! azalmayan, ≤ 10000 — create_pool kontrol eder).
//!
//! Defaulted: max(provision_bps[3] × kalan; kalan + birikmiş faiz − teminat − k × değer),
//! k = pool.recovery_coeff_bps (ev 6300, araç 5400).
//!
//! Yuvarlama protokol lehine: karşılık yukarı, kurtarma tahmini (k × değer) aşağı yuvarlanır;
//! ikisi de NAV'ı tutucu yönde düşürür.

use anchor_lang::prelude::*;

use crate::errors::GlassError;
use crate::state::LoanStatus;

pub const BPS_DENOM: u128 = 10_000;

/// Durumun `provision_bps` indeksi; karşılık tutulmayan durumlar için `None`.
pub fn provision_tier(status: LoanStatus) -> Option<usize> {
    match status {
        LoanStatus::Active => Some(0),
        LoanStatus::Late1 => Some(1),
        LoanStatus::Late2 => Some(2),
        LoanStatus::Defaulted => Some(3),
        _ => None,
    }
}

/// ceil(amount × bps / 10000)
pub fn bps_ceil(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128)
        .checked_mul(bps as u128)
        .and_then(|x| x.checked_add(BPS_DENOM - 1))
        .ok_or(GlassError::MathOverflow)?
        / BPS_DENOM;
    u64::try_from(v).map_err(|_| GlassError::MathOverflow.into())
}

/// floor(amount × bps / 10000)
pub fn bps_floor(amount: u64, bps: u16) -> Result<u64> {
    let v = (amount as u128).checked_mul(bps as u128).ok_or(GlassError::MathOverflow)? / BPS_DENOM;
    u64::try_from(v).map_err(|_| GlassError::MathOverflow.into())
}

/// Defaulted karşılığının ikinci terimi için girdiler.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DefaultInputs {
    /// Temerrüde kadar birikmiş, ödenmemiş faiz (micro-USDC).
    pub accrued_interest: u64,
    /// CollateralEscrow'da kalan teminat.
    pub collateral: u64,
    /// Değer: min(satış fiyatı, imzalı değer).
    pub value: u64,
    /// k (bps): ev 6300, araç 5400.
    pub recovery_coeff_bps: u16,
}

/// Bir kredi için olması gereken karşılık.
pub fn target_provision(
    status: LoanStatus,
    remaining_principal: u64,
    provision_bps: &[u16; 4],
    defaulted: DefaultInputs,
) -> Result<u64> {
    let Some(tier) = provision_tier(status) else {
        return Ok(0);
    };
    let floor_part = bps_ceil(remaining_principal, provision_bps[tier])?;
    if status != LoanStatus::Defaulted {
        return Ok(floor_part);
    }
    // kalan + faiz − teminat − k × değer (negatifse 0)
    let claim = remaining_principal
        .checked_add(defaulted.accrued_interest)
        .ok_or(GlassError::MathOverflow)?;
    let expected_recovery = defaulted
        .collateral
        .checked_add(bps_floor(defaulted.value, defaulted.recovery_coeff_bps)?)
        .ok_or(GlassError::MathOverflow)?;
    let expected_loss = claim.saturating_sub(expected_recovery);
    Ok(floor_part.max(expected_loss))
}

/// Havuzun toplam karşılığını kredi düzeyindeki değişimle günceller: total − old + new.
/// Dönüş: (yeni havuz toplamı, işaretli fark).
pub fn apply_provision_change(pool_total: u64, old_loan: u64, new_loan: u64) -> Result<(u64, i64)> {
    let without = pool_total.checked_sub(old_loan).ok_or(GlassError::InvariantViolation)?;
    let total = without.checked_add(new_loan).ok_or(GlassError::MathOverflow)?;
    let delta = (new_loan as i128) - (old_loan as i128);
    let delta = i64::try_from(delta).map_err(|_| GlassError::MathOverflow)?;
    Ok((total, delta))
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;
    const TIERS: [u16; 4] = [0, 500, 1500, 1500];

    fn none() -> DefaultInputs {
        DefaultInputs::default()
    }

    #[test]
    fn kademeler_dogru_indeksten() {
        let rem = 70_000 * USDC;
        assert_eq!(target_provision(LoanStatus::Active, rem, &TIERS, none()).unwrap(), 0);
        assert_eq!(target_provision(LoanStatus::Late1, rem, &TIERS, none()).unwrap(), 3_500 * USDC);
        assert_eq!(target_provision(LoanStatus::Late2, rem, &TIERS, none()).unwrap(), 10_500 * USDC);
        assert_eq!(target_provision(LoanStatus::PaidOff, rem, &TIERS, none()).unwrap(), 0);
        assert_eq!(target_provision(LoanStatus::Recovered, rem, &TIERS, none()).unwrap(), 0);
    }

    #[test]
    fn defaulted_taban_baskin_oldugunda() {
        // Değer yüksek: beklenen zarar 0 → taban %15.
        let d = DefaultInputs {
            accrued_interest: 1_225 * USDC,
            collateral: 1_085 * USDC,
            value: 100_000 * USDC,
            recovery_coeff_bps: 6300,
        };
        assert_eq!(target_provision(LoanStatus::Defaulted, 70_000 * USDC, &TIERS, d).unwrap(), 10_500 * USDC);
    }

    #[test]
    fn defaulted_beklenen_zarar_baskin_oldugunda() {
        // Ev: kalan 70.000, faiz 6.125, teminat 1.628,13, değer 100.000, k=0,63
        // 76.125 − 1.628,13 − 63.000 = 11.496,87 > taban 10.500 → 11.496,87
        let d = DefaultInputs {
            accrued_interest: 6_125 * USDC,
            collateral: 1_628_130_000,
            value: 100_000 * USDC,
            recovery_coeff_bps: 6300,
        };
        assert_eq!(
            target_provision(LoanStatus::Defaulted, 70_000 * USDC, &TIERS, d).unwrap(),
            11_496_870_000
        );
    }

    #[test]
    fn arac_katsayisi() {
        // Araç: kalan 12.000, faiz 1.350, teminat 747,30, değer 20.000, k=0,54 → 13.350 − 747,30 − 10.800 = 1.802,70
        // Taban %15 × 12.000 = 1.800 → max = 1.802,70
        let d = DefaultInputs {
            accrued_interest: 1_350 * USDC,
            collateral: 747_300_000,
            value: 20_000 * USDC,
            recovery_coeff_bps: 5400,
        };
        assert_eq!(target_provision(LoanStatus::Defaulted, 12_000 * USDC, &TIERS, d).unwrap(), 1_802_700_000);
    }

    #[test]
    fn yuvarlama_protokol_lehine() {
        assert_eq!(bps_ceil(1, 500).unwrap(), 1);
        assert_eq!(bps_floor(1, 6300).unwrap(), 0);
        assert_eq!(bps_ceil(19_999, 500).unwrap(), 1_000);
    }

    #[test]
    fn havuz_toplami_fark_ile_guncellenir() {
        assert_eq!(apply_provision_change(10_000, 0, 3_500).unwrap(), (13_500, 3_500));
        assert_eq!(apply_provision_change(13_500, 3_500, 10_500).unwrap(), (20_500, 7_000));
        assert_eq!(apply_provision_change(20_500, 10_500, 0).unwrap(), (10_000, -10_500));
        // Kredinin eski karşılığı havuz toplamından büyükse sayaçlar ayrışmış demektir.
        assert!(apply_provision_change(100, 200, 0).is_err());
    }

    #[test]
    fn tasma_hata_doner() {
        assert!(bps_ceil(u64::MAX, 10_000).is_ok());
        let d = DefaultInputs { accrued_interest: u64::MAX, ..Default::default() };
        assert!(target_provision(LoanStatus::Defaulted, 1, &TIERS, d).is_err());
    }
}
