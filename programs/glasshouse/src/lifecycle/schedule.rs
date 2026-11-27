//! Gecikme takvimi — saf fonksiyonlar (Clock değeri dışarıdan verilir).
//!
//! Kaçırılan taksit sayısı sayaç artırarak değil zamandan türetilir:
//!   now < next_due + grace           → 0
//!   aksi halde                       → (now − next_due − grace) / period + 1
//! `last_processed_period` = crank'in en son işlediği kaçırılan taksit sayısı (0..=3). Aynı adım
//! iki kez işlenmez; crank yalnızca (last_processed, missed] aralığındaki adımları uygular.

use anchor_lang::prelude::*;

use crate::errors::GlassError;
use crate::state::LoanStatus;

/// Temerrüde kadar kaçırılabilecek taksit (3. kaçırılan → Defaulted).
pub const DEFAULT_AFTER_MISSED: u64 = 3;
/// Gecikme bedeli: taksidin %2'si.
pub const LATE_FEE_BPS: u64 = 200;

/// Şu ana kadar kaçırılmış taksit sayısı.
pub fn missed_installments(now: i64, next_due: i64, grace_seconds: i64, period_seconds: i64) -> Result<u64> {
    require!(period_seconds > 0 && grace_seconds >= 0, GlassError::ParamOutOfBounds);
    let threshold = next_due.checked_add(grace_seconds).ok_or(GlassError::MathOverflow)?;
    if now < threshold {
        return Ok(0);
    }
    let late_by = now.checked_sub(threshold).ok_or(GlassError::MathOverflow)?;
    let full_periods = (late_by / period_seconds) as u64;
    full_periods.checked_add(1).ok_or_else(|| GlassError::MathOverflow.into())
}

/// Kaçırılan taksit sayısına karşılık gelen durum (0 → Active).
pub fn status_for_missed(missed: u64) -> LoanStatus {
    match missed {
        0 => LoanStatus::Active,
        1 => LoanStatus::Late1,
        2 => LoanStatus::Late2,
        _ => LoanStatus::Defaulted,
    }
}

/// Crank'in bu çağrıda uygulayacağı adımlar: (last_processed, min(missed, 3)].
/// Boş aralık → yapılacak bir şey yok (idempotent).
pub fn pending_steps(last_processed: u64, missed: u64) -> core::ops::RangeInclusive<u64> {
    let to = missed.min(DEFAULT_AFTER_MISSED);
    last_processed.saturating_add(1)..=to
}

/// Gecikme bedeli: taksidin %2'si, yukarı yuvarlanır (protokol lehine).
pub fn late_fee(installment: u64) -> Result<u64> {
    let v = (installment as u128)
        .checked_mul(LATE_FEE_BPS as u128)
        .and_then(|x| x.checked_add(9_999))
        .ok_or(GlassError::MathOverflow)?
        / 10_000;
    u64::try_from(v).map_err(|_| GlassError::MathOverflow.into())
}

/// Temerrüt alacağındaki ÖDENMEMİŞ birikmiş faiz: dönem faizi × dönem sayısı − bu gecikme döngüsünde
/// teminattan zaten ödenen faiz (negatifse 0). Late2'de kesilen taksidin faizi bir kez ödenmiştir;
/// alacağa ikinci kez eklenmez.
pub fn unpaid_accrued_interest(per_period: u64, periods: u64, settled: u64) -> Result<u64> {
    let total = per_period.checked_mul(periods).ok_or(GlassError::MathOverflow)?;
    Ok(total.saturating_sub(settled))
}

/// Crank'in uygulayabileceği durumlar (Active / Late1 / Late2). Defaulted dahil değil: sonrası record_recovery.
pub fn is_crankable(status: LoanStatus) -> bool {
    matches!(status, LoanStatus::Active | LoanStatus::Late1 | LoanStatus::Late2)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DUE: i64 = 1_000;
    const GRACE: i64 = 10;
    const PERIOD: i64 = 60;

    #[test]
    fn grace_icinde_kacirilan_yok() {
        assert_eq!(missed_installments(DUE, DUE, GRACE, PERIOD).unwrap(), 0);
        assert_eq!(missed_installments(DUE + GRACE - 1, DUE, GRACE, PERIOD).unwrap(), 0);
    }

    #[test]
    fn grace_bitince_bir_sonra_her_donem_bir_artar() {
        assert_eq!(missed_installments(DUE + GRACE, DUE, GRACE, PERIOD).unwrap(), 1);
        assert_eq!(missed_installments(DUE + GRACE + PERIOD - 1, DUE, GRACE, PERIOD).unwrap(), 1);
        assert_eq!(missed_installments(DUE + GRACE + PERIOD, DUE, GRACE, PERIOD).unwrap(), 2);
        assert_eq!(missed_installments(DUE + GRACE + 2 * PERIOD, DUE, GRACE, PERIOD).unwrap(), 3);
        assert_eq!(missed_installments(DUE + GRACE + 10 * PERIOD, DUE, GRACE, PERIOD).unwrap(), 11);
    }

    #[test]
    fn gecersiz_parametre_reddedilir() {
        assert!(missed_installments(DUE, DUE, GRACE, 0).is_err());
        assert!(missed_installments(DUE, DUE, -1, PERIOD).is_err());
    }

    #[test]
    fn durum_eslemesi() {
        assert_eq!(status_for_missed(0), LoanStatus::Active);
        assert_eq!(status_for_missed(1), LoanStatus::Late1);
        assert_eq!(status_for_missed(2), LoanStatus::Late2);
        assert_eq!(status_for_missed(3), LoanStatus::Defaulted);
        assert_eq!(status_for_missed(9), LoanStatus::Defaulted);
    }

    #[test]
    fn crank_adimlari_idempotent() {
        assert_eq!(pending_steps(0, 0).count(), 0);
        assert_eq!(pending_steps(0, 1).collect::<Vec<_>>(), vec![1]);
        assert_eq!(pending_steps(0, 3).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert_eq!(pending_steps(1, 2).collect::<Vec<_>>(), vec![2]);
        // Aynı dönem ikinci kez: boş.
        assert_eq!(pending_steps(2, 2).count(), 0);
        // 3'ten sonrası yok.
        assert_eq!(pending_steps(3, 7).count(), 0);
        assert_eq!(pending_steps(1, 9).collect::<Vec<_>>(), vec![2, 3]);
    }

    #[test]
    fn odenmemis_faiz_teminattan_odenen_kismi_dusurur() {
        // Maria: 15 ay × 407,61 − teminattan ödenen 408,33 (bir ayın faizi)
        let per = 407_610_000u64;
        assert_eq!(unpaid_accrued_interest(per, 15, 0).unwrap(), 15 * per);
        assert_eq!(unpaid_accrued_interest(per, 15, 408_330_000).unwrap(), 15 * per - 408_330_000);
        // Ödenen faiz birikenden büyükse 0 (negatif olmaz).
        assert_eq!(unpaid_accrued_interest(per, 0, 408_330_000).unwrap(), 0);
        assert!(unpaid_accrued_interest(u64::MAX, 2, 0).is_err());
    }

    #[test]
    fn gecikme_bedeli_yukari_yuvarlanir() {
        // Maria: 542,71 USDC taksit → 10,8542 → 10,854200
        assert_eq!(late_fee(542_710_000).unwrap(), 10_854_200);
        assert_eq!(late_fee(1).unwrap(), 1);
        assert_eq!(late_fee(0).unwrap(), 0);
    }
}
