//! Zarar sırası — saf fonksiyon.
//!
//! Alacak (claim) = kalan anapara + birikmiş faiz + birikmiş gecikme bedeli.
//! Karşılama sırası:
//!   1. Borçlunun teminatı (CollateralEscrow)
//!   2. Satış geliri (record_recovery'de gerçek transferle gelir)
//!   3. Underwriter stake'i — MVP'de yok (stretch); bu basamak atlanır
//!   4. FirstLossVault (platformun junior kasası)
//!   5. Reserve (yedek fon)
//!   6. Senior yatırımcılar — kalan açık; nakit hareketi yok, total_outstanding düşer
//!
//! Teminat + satış geliri alacağı aşarsa fazlası `surplus` olarak döner (borçluya iade edilir).
//!
//! Havuz muhasebesi (record_recovery uygular):
//!   idle_cash          += collateral_used + proceeds_used + first_loss_used + reserve_used
//!   total_outstanding  −= remaining_principal
//!   first_loss_balance −= first_loss_used,  reserve_balance −= reserve_used
//!   loss_provision     −= kredinin karşılığı (gerçek zarar artık bakiyelere yansıdı)
//! Böylece senior NAV değişimi = alacağın faiz kısmı − senior_loss olur.

use anchor_lang::prelude::*;

use crate::errors::GlassError;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WaterfallInput {
    pub remaining_principal: u64,
    pub accrued_interest: u64,
    pub late_fees: u64,
    /// CollateralEscrow'da kalan teminat.
    pub collateral: u64,
    /// Satış/icra sonrası net gelir.
    pub proceeds: u64,
    /// Havuzun FirstLossVault bakiyesi (first_loss_balance).
    pub first_loss_available: u64,
    /// Havuzun yedek fonu (reserve_balance; reserve_pending dahil değil).
    pub reserve_available: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WaterfallResult {
    pub claim: u64,
    pub collateral_used: u64,
    pub proceeds_used: u64,
    /// Teminat + gelirden alacak karşılandıktan sonra artan (borçluya iade).
    pub surplus: u64,
    /// claim − collateral_used − proceeds_used
    pub loss: u64,
    pub first_loss_used: u64,
    pub reserve_used: u64,
    /// Yatırımcılara yansıyan kısım.
    pub senior_loss: u64,
}

pub fn apply_waterfall(i: &WaterfallInput) -> Result<WaterfallResult> {
    let claim = i
        .remaining_principal
        .checked_add(i.accrued_interest)
        .and_then(|x| x.checked_add(i.late_fees))
        .ok_or(GlassError::MathOverflow)?;

    // 1. Teminat
    let collateral_used = i.collateral.min(claim);
    let mut open = claim - collateral_used;

    // 2. Satış geliri
    let proceeds_used = i.proceeds.min(open);
    open -= proceeds_used;

    let surplus = (i.collateral - collateral_used)
        .checked_add(i.proceeds - proceeds_used)
        .ok_or(GlassError::MathOverflow)?;
    let loss = open;

    // 3. Underwriter stake'i: MVP'de yok.

    // 4. İlk zarar kasası
    let first_loss_used = i.first_loss_available.min(open);
    open -= first_loss_used;

    // 5. Yedek fon
    let reserve_used = i.reserve_available.min(open);
    open -= reserve_used;

    // 6. Senior
    Ok(WaterfallResult {
        claim,
        collateral_used,
        proceeds_used,
        surplus,
        loss,
        first_loss_used,
        reserve_used,
        senior_loss: open,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    /// PDF "Stres testi: dürüst rakamlar" — ev kredisi: 70.000 kalan, 15 ay faiz (6.125),
    /// teminat 3 × 542,71 = 1.628,13.
    fn house_loan(proceeds: u64, fl: u64, res: u64) -> WaterfallInput {
        WaterfallInput {
            remaining_principal: 70_000 * USDC,
            accrued_interest: 6_125 * USDC,
            late_fees: 0,
            collateral: 1_628_130_000,
            proceeds,
            first_loss_available: fl,
            reserve_available: res,
        }
    }

    /// `n` temerrüdü sırayla işler; kasalar krediler arasında azalır.
    fn run_pool(n: usize, proceeds: u64, mut fl: u64, mut res: u64) -> (u64, u64) {
        let (mut total_loss, mut senior) = (0u64, 0u64);
        for _ in 0..n {
            let r = apply_waterfall(&house_loan(proceeds, fl, res)).unwrap();
            fl -= r.first_loss_used;
            res -= r.reserve_used;
            total_loss += r.loss;
            senior += r.senior_loss;
        }
        (total_loss, senior)
    }

    #[test]
    fn tek_kredi_acik_belgeyle_ayni() {
        // %30 düşüş, masraf %10: net satış 63.000 → açık 11.496,87 (belgede 11.497)
        let r = apply_waterfall(&house_loan(63_000 * USDC, 0, 0)).unwrap();
        assert_eq!(r.claim, 76_125 * USDC);
        assert_eq!(r.loss, 11_496_870_000);
        assert_eq!(r.senior_loss, r.loss);
        assert_eq!(r.surplus, 0);
    }

    #[test]
    fn stres_yuzde30_dusus_yatirimciya_sifir() {
        // 20 temerrüt, kasa 350.000 + yedek 35.000 → toplam zarar 229.937,4; yatırımcıya 0
        let (loss, senior) = run_pool(20, 63_000 * USDC, 350_000 * USDC, 35_000 * USDC);
        assert_eq!(loss, 229_937_400_000);
        assert_eq!(senior, 0);
    }

    #[test]
    fn stres_yuzde40_dusus_yatirimciya_24937() {
        // Net satış 54.000 → toplam zarar 409.937,4; yatırımcıya 24.937,4 (belge: 24.937)
        let (loss, senior) = run_pool(20, 54_000 * USDC, 350_000 * USDC, 35_000 * USDC);
        assert_eq!(loss, 409_937_400_000);
        assert_eq!(senior, 24_937_400_000);
    }

    #[test]
    fn stres_yuzde40_30_temerrut() {
        // Belge: yatırımcıya 229.906
        let (loss, senior) = run_pool(30, 54_000 * USDC, 350_000 * USDC, 35_000 * USDC);
        assert_eq!(loss, 614_906_100_000);
        assert_eq!(senior, 229_906_100_000);
    }

    #[test]
    fn mod_2008_kasasiz_zarar_dogrudan_yatirimciya() {
        let (loss, senior) = run_pool(20, 63_000 * USDC, 0, 0);
        assert_eq!(senior, loss);
    }

    #[test]
    fn siralama_kasa_once_sonra_yedek() {
        let r = apply_waterfall(&house_loan(63_000 * USDC, 10_000 * USDC, 5_000 * USDC)).unwrap();
        assert_eq!(r.first_loss_used, 10_000 * USDC);
        assert_eq!(r.reserve_used, 1_496_870_000);
        assert_eq!(r.senior_loss, 0);

        let r = apply_waterfall(&house_loan(63_000 * USDC, 5_000 * USDC, 5_000 * USDC)).unwrap();
        assert_eq!(r.first_loss_used, 5_000 * USDC);
        assert_eq!(r.reserve_used, 5_000 * USDC);
        assert_eq!(r.senior_loss, 1_496_870_000);
    }

    #[test]
    fn fazla_gelir_borcluya_doner() {
        let r = apply_waterfall(&house_loan(80_000 * USDC, 1, 1)).unwrap();
        assert_eq!(r.loss, 0);
        assert_eq!(r.first_loss_used, 0);
        assert_eq!(r.collateral_used, 1_628_130_000);
        assert_eq!(r.proceeds_used, 76_125 * USDC - 1_628_130_000);
        assert_eq!(r.surplus, 80_000 * USDC - r.proceeds_used);
    }

    #[test]
    fn gecikme_bedeli_alacaga_dahil() {
        let mut i = house_loan(63_000 * USDC, 0, 0);
        i.late_fees = 10_854_200;
        let r = apply_waterfall(&i).unwrap();
        assert_eq!(r.claim, 76_125 * USDC + 10_854_200);
        assert_eq!(r.loss, 11_496_870_000 + 10_854_200);
    }

    #[test]
    fn tutarlilik_her_zaman_kapanir() {
        for proceeds in [0, 1, 50_000 * USDC, 74_496_870_000, 74_496_870_001, 200_000 * USDC] {
            for fl in [0, 3_000 * USDC, 100_000 * USDC] {
                let r = apply_waterfall(&house_loan(proceeds, fl, 2_000 * USDC)).unwrap();
                assert_eq!(r.collateral_used + r.proceeds_used + r.loss, r.claim);
                assert_eq!(r.first_loss_used + r.reserve_used + r.senior_loss, r.loss);
            }
        }
    }

    #[test]
    fn tasma_hata_doner() {
        let i = WaterfallInput { remaining_principal: u64::MAX, accrued_interest: 1, ..Default::default() };
        assert!(apply_waterfall(&i).is_err());
    }
}
