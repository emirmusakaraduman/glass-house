//! Sabit nokta matematik. 1e18 ölçekli u128, her işlem checked; ölçekli her çarpım
//! U256 ara değerli `mul_div`'den geçer (karar 3). Sonuç `try_from` ile döner,
//! sığmazsa `MathOverflow`.
//!
//! Yuvarlama: borçludan alınan YUKARI, borçluya/yatırımcıya verilen AŞAĞI.
//! Faiz bölüşümü küsuratı yatırımcı (havuz) payına gider.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GlassError;
pub use crate::u256::U256;

// ---------------------------------------------------------------- çekirdek

fn u256_to_u128(v: U256) -> Result<u128> {
    if v > U256::from(u128::MAX) {
        return err!(GlassError::MathOverflow);
    }
    Ok(v.low_u128())
}

fn u128_to_u64(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| error!(GlassError::MathOverflow))
}

/// floor(a·b/d), ara değer 256 bit.
pub fn mul_div(a: u128, b: u128, d: u128) -> Result<u128> {
    if d == 0 {
        return err!(GlassError::MathOverflow);
    }
    u256_to_u128(U256::from(a) * U256::from(b) / U256::from(d))
}

/// ceil(a·b/d), ara değer 256 bit.
pub fn mul_div_up(a: u128, b: u128, d: u128) -> Result<u128> {
    if d == 0 {
        return err!(GlassError::MathOverflow);
    }
    let num = (U256::from(a) * U256::from(b))
        .checked_add(U256::from(d - 1))
        .ok_or_else(|| error!(GlassError::MathOverflow))?;
    u256_to_u128(num / U256::from(d))
}

/// base^exp, base 1e18 ölçekli; kare alarak üs alma.
pub fn pow_scaled(base: u128, mut exp: u32) -> Result<u128> {
    let mut result = SCALE;
    let mut b = base;
    while exp > 0 {
        if exp & 1 == 1 {
            result = mul_div(result, b, SCALE)?;
        }
        exp >>= 1;
        if exp > 0 {
            b = mul_div(b, b, SCALE)?;
        }
    }
    Ok(result)
}

// ---------------------------------------------------------------- faiz

/// Aylık oran, 1e18 ölçekli: rate_bps / 10_000 / 12.
pub fn monthly_rate(rate_bps: u16) -> Result<u128> {
    mul_div(
        rate_bps as u128,
        SCALE,
        BPS_DENOM as u128 * MONTHS_PER_YEAR,
    )
}

/// Sabit taksit: M = P·r·x/(x−1), x = (1+r)^n. Borçludan alındığı için yukarı yuvarlanır.
pub fn installment(principal: u64, rate_bps: u16, term_months: u16) -> Result<u64> {
    if principal == 0 || term_months == 0 {
        return err!(GlassError::ZeroAmount);
    }
    let r = monthly_rate(rate_bps)?;
    let x = pow_scaled(
        SCALE.checked_add(r).ok_or_else(|| error!(GlassError::MathOverflow))?,
        term_months as u32,
    )?;
    if x <= SCALE {
        return err!(GlassError::MathOverflow);
    }
    let num = U256::from(principal) * U256::from(r) * U256::from(x);
    let den = U256::from(x - SCALE) * U256::from(SCALE);
    let m = (num + den - U256::one()) / den;
    u128_to_u64(u256_to_u128(m)?)
}

/// Bir dönemin faizi: kalan × r, yukarı yuvarlanır (borçludan alınır).
pub fn interest_for_period(remaining: u64, rate_bps: u16) -> Result<u64> {
    let r = monthly_rate(rate_bps)?;
    u128_to_u64(mul_div_up(remaining as u128, r, SCALE)?)
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct PaymentSplit {
    pub late_fee: u64,
    pub interest: u64,
    pub principal: u64,
    /// Ödemenin borca uygulanmayan kısmı (fazla ödeme).
    pub unapplied: u64,
}

/// Ödeme sırası: gecikme bedeli → faiz → anapara.
pub fn split_payment(
    payment: u64,
    remaining: u64,
    rate_bps: u16,
    late_fee_due: u64,
) -> Result<PaymentSplit> {
    let late_fee = payment.min(late_fee_due);
    let rest = payment - late_fee;
    let interest_due = interest_for_period(remaining, rate_bps)?;
    let interest = rest.min(interest_due);
    let rest = rest - interest;
    let principal = rest.min(remaining);
    let unapplied = rest - principal;
    Ok(PaymentSplit {
        late_fee,
        interest,
        principal,
        unapplied,
    })
}

/// Son taksit: kalan anapara + o dönemin faizi (kredi tam sıfırla kapanır).
pub fn final_installment(remaining: u64, rate_bps: u16) -> Result<u64> {
    let interest = interest_for_period(remaining, rate_bps)?;
    remaining
        .checked_add(interest)
        .ok_or_else(|| error!(GlassError::MathOverflow))
}

/// Faiz bölüşümü: (havuz, platform, yedek). Platform ve yedek payı aşağı yuvarlanır,
/// küsurat havuza (yatırımcıya) kalır.
pub fn split_interest(interest: u64, rate_bps: u16) -> Result<(u64, u64, u64)> {
    let platform = if rate_bps == 0 {
        0
    } else {
        u128_to_u64(mul_div(
            interest as u128,
            PLATFORM_INTEREST_BPS as u128,
            rate_bps as u128,
        )?)?
    }
    .min(interest);
    let reserve = if rate_bps == 0 {
        0
    } else {
        u128_to_u64(mul_div(
            interest as u128,
            RESERVE_INTEREST_BPS as u128,
            rate_bps as u128,
        )?)?
    }
    .min(interest - platform);
    Ok((interest - platform - reserve, platform, reserve))
}

// ---------------------------------------------------------------- kredi boyutlandırma

/// Açılış ücreti: anaparanın %1'i, yukarı yuvarlanır (borçludan alınır).
pub fn origination_fee(principal: u64) -> Result<u64> {
    u128_to_u64(mul_div_up(
        principal as u128,
        ORIGINATION_FEE_BPS as u128,
        BPS_DENOM as u128,
    )?)
}

/// Verilebilecek en yüksek anapara: floor(değer × max_ltv).
pub fn max_principal(value: u64, max_ltv_bps: u16) -> Result<u64> {
    u128_to_u64(mul_div(
        value as u128,
        max_ltv_bps as u128,
        BPS_DENOM as u128,
    )?)
}

/// En düşük peşinat: ceil(fiyat × (1 − max_ltv)).
pub fn min_down_payment(price: u64, max_ltv_bps: u16) -> Result<u64> {
    let ltv = max_ltv_bps.min(MAX_BPS);
    u128_to_u64(mul_div_up(
        price as u128,
        (MAX_BPS - ltv) as u128,
        BPS_DENOM as u128,
    )?)
}

/// Teminat: 3 taksit.
pub fn collateral_amount(installment: u64) -> Result<u64> {
    installment
        .checked_mul(COLLATERAL_INSTALLMENTS)
        .ok_or_else(|| error!(GlassError::MathOverflow))
}

// ---------------------------------------------------------------- testler

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    /// micro-USDC → en yakın cent (1 cent = 10_000 micro).
    fn cents(micro: u64) -> u64 {
        (micro + 5_000) / 10_000
    }

    #[test]
    fn maria_house_installment_and_first_interest() {
        let p = 70_000 * USDC;
        let m = installment(p, 700, 240).unwrap();
        assert_eq!(cents(m), 54_271, "taksit 542,71 olmalı, bulunan {m}");
        let i = interest_for_period(p, 700).unwrap();
        assert_eq!(cents(i), 40_833, "ilk ay faizi 408,33 olmalı, bulunan {i}");
        // f = taksit/kredi ≈ 0,007753
        assert_eq!(((m as u128 * 1_000_000 + p as u128 / 2) / p as u128) as u64, 7_753);
    }

    #[test]
    fn diego_vehicle_installment_and_first_interest() {
        let p = 12_000 * USDC;
        let m = installment(p, 900, 60).unwrap();
        assert_eq!(cents(m), 24_910, "taksit 249,10 olmalı, bulunan {m}");
        let i = interest_for_period(p, 900).unwrap();
        assert_eq!(i, 90 * USDC, "ilk ay faizi 90,00 olmalı");
        assert_eq!(((m as u128 * 1_000_000 + p as u128 / 2) / p as u128) as u64, 20_758);
    }

    fn amortize(p: u64, rate_bps: u16, n: u16) -> (u64, u64) {
        let m = installment(p, rate_bps, n).unwrap();
        let mut remaining = p;
        let mut total_interest = 0u64;
        for month in 1..=n {
            let interest = interest_for_period(remaining, rate_bps).unwrap();
            let pay = if month == n {
                final_installment(remaining, rate_bps).unwrap()
            } else {
                m
            };
            let split = split_payment(pay, remaining, rate_bps, 0).unwrap();
            assert_eq!(split.interest, interest);
            assert_eq!(split.unapplied, 0);
            remaining -= split.principal;
            total_interest += split.interest;
            if month < n {
                assert!(remaining > 0, "erken sıfırlandı: ay {month}");
            }
        }
        assert_eq!(remaining, 0, "tam amortisman sonunda kalan anapara 0 olmalı");
        (m, total_interest)
    }

    #[test]
    fn full_amortization_zeroes_out() {
        let (_, interest) = amortize(70_000 * USDC, 700, 240);
        // doküman: toplam faiz ≈ 60.250
        assert!((60_240 * USDC..60_260 * USDC).contains(&interest), "{interest}");
        let (_, interest) = amortize(12_000 * USDC, 900, 60);
        // doküman: toplam faiz ≈ 2.946
        assert!((2_940 * USDC..2_950 * USDC).contains(&interest), "{interest}");
    }

    #[test]
    fn extreme_bounds_do_not_overflow() {
        // karar 2: uç değer 2000 bps / 360 ay
        let m = installment(1_000_000 * USDC, 2_000, 360).unwrap();
        assert!(m > 0);
        let (_, _) = amortize(1_000_000 * USDC, 2_000, 360);
        // en düşük faiz ve 1 ay
        assert!(installment(1_000_000 * USDC, 1, 360).unwrap() > 0);
        assert!(installment(USDC, 1, 1).unwrap() > 0);
        // u64 tavanı panik etmemeli (Ok ya da MathOverflow)
        let _ = installment(u64::MAX, 2_000, 360);
    }

    #[test]
    fn mul_div_handles_wide_products() {
        // a*b taşar u128'i ama U256 ara değeriyle sonuç sığar
        let a = u128::MAX / 2;
        assert_eq!(mul_div(a, 4, 4).unwrap(), a);
        assert!(mul_div(u128::MAX, u128::MAX, 1).is_err());
        assert!(mul_div(1, 1, 0).is_err());
    }

    #[test]
    fn rounding_directions() {
        assert_eq!(mul_div(10, 1, 3).unwrap(), 3);
        assert_eq!(mul_div_up(10, 1, 3).unwrap(), 4);
        assert_eq!(mul_div_up(9, 1, 3).unwrap(), 3);
    }

    #[test]
    fn interest_split_remainder_goes_to_pool() {
        // ev: 408_333_334 faiz → %0,5/%7 platform ve yedek
        let (pool, platform, reserve) = split_interest(408_333_334, 700).unwrap();
        assert_eq!(pool + platform + reserve, 408_333_334);
        assert_eq!(platform, reserve);
        assert!(pool > platform * 10);
        // araç: 8/0,5/0,5
        let (pool, platform, reserve) = split_interest(90 * USDC, 900).unwrap();
        assert_eq!(platform, 5_000_000);
        assert_eq!(reserve, 5_000_000);
        assert_eq!(pool, 80 * USDC);
        // küçük faizde toplam asla aşmaz
        let (p, a, b) = split_interest(1, 700).unwrap();
        assert_eq!(p + a + b, 1);
    }

    #[test]
    fn payment_order_fee_interest_principal() {
        let s = split_payment(1_000, 10_000, 700, 300).unwrap();
        assert_eq!(s.late_fee, 300);
        assert_eq!(s.interest, 59); // ceil(10_000 × 0,005833…)
        assert_eq!(s.principal, 641);
        // fazla ödeme
        let s = split_payment(50_000, 1_000, 700, 0).unwrap();
        assert_eq!(s.principal, 1_000);
        assert_eq!(s.unapplied, 50_000 - 1_000 - s.interest);
    }

    #[test]
    fn escrow_and_collateral_reference_values() {
        // Maria: fiyat 100.000, peşinat 30.000, ücret 700 → escrow 30.700; teminat 1.628
        let price = 100_000 * USDC;
        let down = min_down_payment(price, 7_000).unwrap();
        assert_eq!(down, 30_000 * USDC);
        let principal = price - down;
        let fee = origination_fee(principal).unwrap();
        assert_eq!(down + fee, 30_700 * USDC);
        let m = installment(principal, 700, 240).unwrap();
        assert_eq!(collateral_amount(m).unwrap() / USDC, 1_628);
        // Diego: fiyat 20.000, peşinat 8.000, ücret 120 → 8.120; teminat 747
        let price = 20_000 * USDC;
        let down = min_down_payment(price, 6_000).unwrap();
        assert_eq!(down, 8_000 * USDC);
        let principal = price - down;
        assert_eq!(down + origination_fee(principal).unwrap(), 8_120 * USDC);
        let m = installment(principal, 900, 60).unwrap();
        assert_eq!(collateral_amount(m).unwrap() / USDC, 747);
    }

    /// tests/helpers/loanMath.ts ile birebir aynı micro değerler (Kişi 2 ±1 micro karşılaştırır).
    /// Biri değişirse ikisi birlikte değişmeli.
    #[test]
    fn exact_values_match_typescript_helper() {
        assert_eq!(installment(70_000 * USDC, 700, 240).unwrap(), 542_709_255);
        assert_eq!(interest_for_period(70_000 * USDC, 700).unwrap(), 408_333_334);
        assert_eq!(installment(12_000 * USDC, 900, 60).unwrap(), 249_100_263);
        assert_eq!(installment(1_000_000 * USDC, 2_000, 360).unwrap(), 16_710_186_863);
        assert_eq!(
            collateral_amount(installment(70_000 * USDC, 700, 240).unwrap()).unwrap(),
            1_628_127_765
        );
    }

    #[test]
    fn max_principal_uses_ltv() {
        assert_eq!(max_principal(100_000 * USDC, 7_000).unwrap(), 70_000 * USDC);
        assert_eq!(max_principal(100_000 * USDC, 9_700).unwrap(), 97_000 * USDC);
    }
}
