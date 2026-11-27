use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod lifecycle; // Kişi 2
pub mod math;
pub mod nav;
pub mod state;
pub mod u256;

pub use instructions::*;
use state::Decision;

// Program ID, `target/deploy/glasshouse-keypair.json` ile `anchor keys sync` edilmiştir.
// Devnet deploy için bu keypair dosyasını YEDEKLE (kaybolursa aynı adrese deploy edilemez).
declare_id!("HLKhCx1dFCCH3oTaaQEBEXZ5PShftueTFTEmKVZFyrP2");

#[program]
pub mod glasshouse {
    use super::*;

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::deposit_handler(ctx, amount)
    }

    pub fn apply_loan(ctx: Context<ApplyLoan>, price: u64, down_payment: u64) -> Result<()> {
        instructions::apply_loan::apply_loan_handler(ctx, price, down_payment)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn approve_loan(
        ctx: Context<ApproveLoan>,
        decision: Decision,
        appraised_value: u64,
        doc_hash: [u8; 32],
        asset_ref_hash: [u8; 32],
        region_code: u16,
        income_ok: bool,
        currency_ok: bool,
    ) -> Result<()> {
        instructions::approve_loan::approve_loan_handler(
            ctx,
            decision,
            appraised_value,
            doc_hash,
            asset_ref_hash,
            region_code,
            income_ok,
            currency_ok,
        )
    }

    /// Permissionless: koşullar zincirde, para yalnızca vault → LoanEscrow.
    pub fn fund_loan(ctx: Context<FundLoan>) -> Result<()> {
        instructions::fund_loan::fund_loan_handler(ctx)
    }

    /// Yalnızca title_agent, deadline öncesi: satıcıya ödeme, ücret bölüşümü, Funded → Active.
    pub fn confirm_title(ctx: Context<ConfirmTitle>) -> Result<()> {
        instructions::confirm_title::confirm_title_handler(ctx)
    }

    /// Deadline geçince herkes: anapara vault'a, peşinat + ücret + teminat borçluya.
    pub fn cancel_funding(ctx: Context<CancelFunding>) -> Result<()> {
        instructions::confirm_title::cancel_funding_handler(ctx)
    }

    pub fn create_pool(ctx: Context<CreatePool>, params: PoolParams) -> Result<()> {
        instructions::create_pool::create_pool_handler(ctx, params)
    }

    pub fn fund_first_loss(ctx: Context<FundFirstLoss>, amount: u64) -> Result<()> {
        instructions::fund_first_loss::fund_first_loss_handler(ctx, amount)
    }

    // ---- Kişi 2 (Backend B) ----

    /// Herkes ödeyebilir: gecikme bedeli → faiz → anapara.
    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        instructions::repay::repay_handler(ctx, amount)
    }

    /// Yalnızca borçlu: cezasız erken kapama, teminat iadesi.
    pub fn payoff(ctx: Context<Payoff>) -> Result<()> {
        instructions::payoff::payoff_handler(ctx)
    }

    /// Pay sahibi: çekim talebi açar, payları kilitler.
    pub fn request_withdraw(ctx: Context<RequestWithdraw>, shares: u64) -> Result<()> {
        instructions::request_withdraw::request_withdraw_handler(ctx, shares)
    }

    /// Permissionless: kuyruktan en fazla 3 talep, işlem anındaki NAV ile.
    pub fn process_withdrawals<'info>(
        ctx: Context<'_, '_, 'info, 'info, ProcessWithdrawals<'info>>,
    ) -> Result<()> {
        instructions::process_withdrawals::process_withdrawals_handler(ctx)
    }

    /// Permissionless: Late1 → Late2 → Defaulted, idempotent.
    pub fn crank_loan(ctx: Context<CrankLoan>) -> Result<()> {
        instructions::crank_loan::crank_loan_handler(ctx)
    }

    /// Yalnızca recovery_agent: satış geliri + zarar sırası.
    pub fn record_recovery(ctx: Context<RecordRecovery>, proceeds: u64) -> Result<()> {
        instructions::record_recovery::record_recovery_handler(ctx, proceeds)
    }
}
