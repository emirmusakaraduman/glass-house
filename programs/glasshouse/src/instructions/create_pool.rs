//! create_pool: havuzu, token hesaplarını ve pay mint'ini açar. Parametreler burada
//! doğrulanır (karar 2: güvenlik aralığı) ve sonrasında DEĞİŞMEZ: parametreleri
//! değiştiren hiçbir instruction yoktur.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::GlassError;
use crate::events::PoolCreated;
use crate::math;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PoolParams {
    pub pool_id: u64,
    pub asset_type: AssetType,
    pub underwriter: Pubkey,
    pub title_agent: Pubkey,
    pub recovery_agent: Pubkey,
    pub max_ltv_bps: u16,
    pub rate_bps: u16,
    pub term_months: u16,
    pub recovery_coeff_bps: u16,
    pub grace_seconds: i64,
    pub period_seconds: i64,
    /// [Active, Late1, Late2, Defaulted-taban]; azalmayan, ≤ 10000.
    pub provision_bps: [u16; 4],
    pub buffer_bps: u16,
    pub brake_late_bps: u16,
    pub brake_reserve_bps: u16,
    pub min_first_loss_bps: u16,
    pub entry_exit_fee_bps: u16,
    pub min_recovery_bps: u16,
    pub title_timeout_seconds: i64,
}

/// Saf doğrulama (zincir hesabı gerektirmez, host'ta test edilir).
pub fn validate_params(p: &PoolParams) -> Result<()> {
    macro_rules! bound {
        ($cond:expr) => {
            require!($cond, GlassError::ParamOutOfBounds)
        };
    }
    bound!(p.max_ltv_bps >= 1 && p.max_ltv_bps <= MAX_LTV_BPS_LIMIT);
    bound!(p.rate_bps >= MIN_RATE_BPS && p.rate_bps <= MAX_RATE_BPS);
    bound!(p.term_months >= MIN_TERM_MONTHS && p.term_months <= MAX_TERM_MONTHS);
    bound!(p.recovery_coeff_bps <= MAX_BPS);
    bound!(p.provision_bps.windows(2).all(|w| w[0] <= w[1]));
    bound!(p.provision_bps.iter().all(|&b| b <= MAX_BPS));
    bound!(p.buffer_bps <= MAX_BUFFER_BPS);
    bound!(p.min_first_loss_bps <= MAX_BPS);
    bound!(p.brake_late_bps <= MAX_BPS);
    bound!(p.brake_reserve_bps <= MAX_BPS);
    bound!(p.min_recovery_bps <= MAX_BPS);
    bound!(p.period_seconds >= 1);
    bound!(p.grace_seconds >= 0 && p.grace_seconds < p.period_seconds);
    bound!(p.entry_exit_fee_bps <= MAX_ENTRY_EXIT_FEE_BPS);
    bound!(p.title_timeout_seconds >= 1);

    // Taşma doğrulaması: uç değerlerde taksit hesaplanabilmeli.
    math::installment(1_000_000 * 1_000_000, p.rate_bps, p.term_months)
        .map_err(|_| error!(GlassError::ParamOutOfBounds))?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(params: PoolParams)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, admin.key().as_ref(), &params.pool_id.to_le_bytes()],
        bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(constraint = usdc_mint.decimals == 6 @ GlassError::ParamOutOfBounds)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// Açılış ücretinin platform yarısının gideceği USDC hesabı.
    #[account(
        constraint = platform_treasury.mint == usdc_mint.key() @ GlassError::ParamOutOfBounds
    )]
    pub platform_treasury: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = pool
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = admin,
        seeds = [FIRST_LOSS_SEED, pool.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = pool
    )]
    pub first_loss_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = admin,
        seeds = [RESERVE_SEED, pool.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = pool
    )]
    pub reserve_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = admin,
        seeds = [SHARES_SEED, pool.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = pool
    )]
    pub share_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_pool_handler(ctx: Context<CreatePool>, params: PoolParams) -> Result<()> {
    validate_params(&params)?;

    let pool = &mut ctx.accounts.pool;
    pool.admin = ctx.accounts.admin.key();
    pool.asset_type = params.asset_type;
    pool.underwriter = params.underwriter;
    pool.title_agent = params.title_agent;
    pool.recovery_agent = params.recovery_agent;
    pool.usdc_mint = ctx.accounts.usdc_mint.key();
    pool.platform_treasury = ctx.accounts.platform_treasury.key();
    pool.pool_id = params.pool_id;

    pool.max_ltv_bps = params.max_ltv_bps;
    pool.rate_bps = params.rate_bps;
    pool.term_months = params.term_months;
    pool.recovery_coeff_bps = params.recovery_coeff_bps;
    pool.grace_seconds = params.grace_seconds;
    pool.period_seconds = params.period_seconds;
    pool.provision_bps = params.provision_bps;
    pool.buffer_bps = params.buffer_bps;
    pool.brake_late_bps = params.brake_late_bps;
    pool.brake_reserve_bps = params.brake_reserve_bps;
    pool.min_first_loss_bps = params.min_first_loss_bps;
    pool.entry_exit_fee_bps = params.entry_exit_fee_bps;
    pool.min_recovery_bps = params.min_recovery_bps;
    pool.title_timeout_seconds = params.title_timeout_seconds;

    pool.next_loan_id = 0;
    pool.idle_cash = 0;
    pool.total_outstanding = 0;
    pool.late_default_principal = 0;
    pool.loss_provision = 0;
    pool.first_loss_balance = 0;
    pool.reserve_balance = 0;
    pool.reserve_pending = 0;
    pool.total_shares = 0;
    pool.withdraw_head = 0;
    pool.withdraw_tail = 0;
    pool.status = PoolStatus::Active;

    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;
    pool.first_loss_bump = ctx.bumps.first_loss_vault;
    pool.reserve_bump = ctx.bumps.reserve_vault;
    pool.share_mint_bump = ctx.bumps.share_mint;
    pool.reserved = [0u8; RESERVED_BYTES];

    emit!(PoolCreated {
        pool: pool.key(),
        admin: pool.admin,
        asset_type: pool.asset_type as u8,
        max_ltv_bps: pool.max_ltv_bps,
        rate_bps: pool.rate_bps,
        term_months: pool.term_months,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ev ürün değerleri (create-pools.ts ile aynı).
    fn house() -> PoolParams {
        PoolParams {
            pool_id: 1,
            asset_type: AssetType::House,
            underwriter: Pubkey::new_unique(),
            title_agent: Pubkey::new_unique(),
            recovery_agent: Pubkey::new_unique(),
            max_ltv_bps: 7_000,
            rate_bps: 700,
            term_months: 240,
            recovery_coeff_bps: 6_300,
            grace_seconds: 10,
            period_seconds: 60,
            provision_bps: [0, 500, 1_500, 1_500],
            buffer_bps: 1_000,
            brake_late_bps: 1_000,
            brake_reserve_bps: DEFAULT_BRAKE_RESERVE_BPS,
            min_first_loss_bps: 500,
            entry_exit_fee_bps: 20,
            min_recovery_bps: 0,
            title_timeout_seconds: 3_600,
        }
    }

    fn rejected(mutate: impl FnOnce(&mut PoolParams)) {
        let mut p = house();
        mutate(&mut p);
        let e = validate_params(&p).unwrap_err();
        assert_eq!(
            e,
            error!(GlassError::ParamOutOfBounds),
            "ParamOutOfBounds bekleniyordu"
        );
    }

    #[test]
    fn product_values_pass() {
        validate_params(&house()).unwrap();
        // araç
        let mut v = house();
        v.asset_type = AssetType::Vehicle;
        v.max_ltv_bps = 6_000;
        v.rate_bps = 900;
        v.term_months = 60;
        v.recovery_coeff_bps = 5_400;
        validate_params(&v).unwrap();
    }

    #[test]
    fn crisis_2008_mode_passes() {
        let mut p = house();
        p.max_ltv_bps = 9_700;
        p.min_first_loss_bps = 0;
        validate_params(&p).unwrap();
    }

    #[test]
    fn bounds_are_inclusive_at_the_edges() {
        let mut p = house();
        p.rate_bps = MAX_RATE_BPS;
        p.term_months = MAX_TERM_MONTHS;
        validate_params(&p).unwrap();
        p.rate_bps = MIN_RATE_BPS;
        p.term_months = MIN_TERM_MONTHS;
        validate_params(&p).unwrap();
    }

    #[test]
    fn each_out_of_bounds_param_is_rejected() {
        rejected(|p| p.max_ltv_bps = 9_701);
        rejected(|p| p.max_ltv_bps = 0);
        rejected(|p| p.rate_bps = 0);
        rejected(|p| p.rate_bps = 2_001);
        rejected(|p| p.term_months = 0);
        rejected(|p| p.term_months = 361);
        rejected(|p| p.recovery_coeff_bps = 10_001);
        rejected(|p| p.provision_bps = [0, 1_500, 500, 1_500]); // azalıyor
        rejected(|p| p.provision_bps = [0, 500, 1_500, 10_001]);
        rejected(|p| p.buffer_bps = 5_001);
        rejected(|p| p.min_first_loss_bps = 10_001);
        rejected(|p| p.brake_late_bps = 10_001);
        rejected(|p| p.brake_reserve_bps = 10_001);
        rejected(|p| p.min_recovery_bps = 10_001);
        rejected(|p| p.period_seconds = 0);
        rejected(|p| {
            p.period_seconds = 60;
            p.grace_seconds = 60; // grace < period olmalı
        });
        rejected(|p| p.grace_seconds = -1);
        rejected(|p| p.entry_exit_fee_bps = 101);
        rejected(|p| p.title_timeout_seconds = 0);
    }

    #[test]
    fn equal_provisions_allowed() {
        // Late-2 ve Defaulted-taban ikisi de %15 (v4 tablosu): azalmayan, strict artan değil.
        let mut p = house();
        p.provision_bps = [0, 500, 1_500, 1_500];
        validate_params(&p).unwrap();
    }
}
