//! process_withdrawals — SAHİBİ: Kişi 2. İzinsiz (herkes çağırabilir).
//!
//! Kuyruk başından (withdraw_head) sırayla en fazla 3 talep işler:
//! - Ödeme işlem anındaki NAV ile: `nav::withdraw_quote(shares, entry_exit_fee_bps, total_shares,
//!   pool_senior_nav)` → (brüt, ücret, net). Net vault'tan talepteki `destination`'a gider;
//!   ücret havuzda kalır (kalan yatırımcıların pay değerini artırır).
//! - Paylar `share_escrow`'dan YAKILIR ve `total_shares` aynı miktar düşer (arz ≤ total_shares).
//! - Talep hesabı kapatılır; kira talep sahibine döner.
//! - Yalnızca serbest nakitten ödenir: net > idle_cash ise işlem orada durur (talep sırada kalır).
//!
//! Hata ve atlama:
//! - Çağıranın verdiği hesaplar talepteki adreslerle uyuşmazsa `InvalidWithdrawRequest` (tx düşer).
//! - Talep geçerli ama `destination` artık kullanılamıyorsa (kapatılmış, mint'i farklı ya da
//!   dondurulmuş token hesabı) talep ATLANIR: `WithdrawSkipped`, kuyruk başı ilerler, paylar
//!   share_escrow'da kilitli kalır ve talep hesabı açık kalır. Kuyruk böylece kilitlenmez.
//!   (Atlanan talebin geri alınması: bilinen sınır, stretch.)
//! - Hiç talep işlenemez ve atlanamazsa: kuyruk boşsa `WithdrawQueueEmpty`, nakit yoksa
//!   `InsufficientIdleCash`.
//!
//! remaining_accounts: talep başına 3 hesap, kuyruk sırasıyla:
//!   [withdraw_request (mut), destination USDC (mut), owner (mut, kira iadesi)] × N, 1 ≤ N ≤ 3

use anchor_lang::prelude::*;
use anchor_lang::AccountsClose;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::GlassError;
use crate::lifecycle::events::{WithdrawProcessed, WithdrawSkipped};
use crate::lifecycle::state::{seeds as lseeds, WithdrawRequest};
use crate::nav::{assert_vault_covers_idle, pool_senior_nav, withdraw_quote};
use crate::state::Pool;

pub const MAX_WITHDRAWALS_PER_TX: usize = 3;
pub const ACCOUNTS_PER_REQUEST: usize = 3;

#[derive(Accounts)]
pub struct ProcessWithdrawals<'info> {
    /// Herkes çağırabilir; yalnızca tx ücretini öder.
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.admin.as_ref(), &pool.pool_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
        token::mint = pool.usdc_mint,
        token::authority = pool,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, seeds = [SHARES_SEED, pool.key().as_ref()], bump = pool.share_mint_bump)]
    pub share_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        seeds = [lseeds::SHARE_ESCROW, pool.key().as_ref()],
        bump,
        token::mint = share_mint,
        token::authority = pool,
    )]
    pub share_escrow: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

/// Ödeme hesabı hâlâ kullanılabilir mi: SPL token hesabı, doğru mint, dondurulmamış.
fn destination_usable(ai: &AccountInfo, usdc_mint: &Pubkey) -> bool {
    if ai.owner != &anchor_spl::token::ID || ai.data_is_empty() {
        return false;
    }
    let Ok(data) = ai.try_borrow_data() else { return false };
    match TokenAccount::try_deserialize(&mut &data[..]) {
        Ok(acc) => acc.mint == *usdc_mint && !acc.is_frozen(),
        Err(_) => false,
    }
}

pub fn process_withdrawals_handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, ProcessWithdrawals<'info>>,
) -> Result<()> {
    let rem = ctx.remaining_accounts;
    require!(
        !rem.is_empty()
            && rem.len() % ACCOUNTS_PER_REQUEST == 0
            && rem.len() / ACCOUNTS_PER_REQUEST <= MAX_WITHDRAWALS_PER_TX,
        GlassError::InvalidWithdrawRequest
    );
    require!(
        ctx.accounts.pool.withdraw_head < ctx.accounts.pool.withdraw_tail,
        GlassError::WithdrawQueueEmpty
    );

    let pool_key = ctx.accounts.pool.key();
    let usdc_mint = ctx.accounts.pool.usdc_mint;
    let admin = ctx.accounts.pool.admin;
    let pool_id_bytes = ctx.accounts.pool.pool_id.to_le_bytes();
    let bump = [ctx.accounts.pool.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[POOL_SEED, admin.as_ref(), &pool_id_bytes, &bump]];

    let (mut processed, mut skipped) = (0u32, 0u32);
    let mut out_of_cash = false;

    for chunk in rem.chunks(ACCOUNTS_PER_REQUEST) {
        if ctx.accounts.pool.withdraw_head >= ctx.accounts.pool.withdraw_tail {
            break;
        }
        let (req_ai, dest_ai, owner_ai) = (&chunk[0], &chunk[1], &chunk[2]);
        let seq = ctx.accounts.pool.withdraw_head;

        // ---- hesaplar talep ile uyuşmalı (yoksa çağıran hatası → tx düşer) ----
        let (expected, _) = Pubkey::find_program_address(
            &[WITHDRAW_REQUEST_SEED, pool_key.as_ref(), &seq.to_le_bytes()],
            ctx.program_id,
        );
        require_keys_eq!(req_ai.key(), expected, GlassError::InvalidWithdrawRequest);
        let req: Account<'info, WithdrawRequest> = Account::try_from(req_ai)?;
        require!(
            req.pool == pool_key && req.seq == seq,
            GlassError::InvalidWithdrawRequest
        );
        require_keys_eq!(owner_ai.key(), req.owner, GlassError::InvalidWithdrawRequest);
        require_keys_eq!(dest_ai.key(), req.destination, GlassError::InvalidWithdrawRequest);
        require!(
            req_ai.is_writable && dest_ai.is_writable && owner_ai.is_writable,
            GlassError::InvalidWithdrawRequest
        );

        // ---- bozuk talep: atla, kuyruk kilitlenmesin ----
        if !destination_usable(dest_ai, &usdc_mint) {
            ctx.accounts.pool.withdraw_head = seq + 1;
            skipped += 1;
            emit!(WithdrawSkipped { pool: pool_key, request: req_ai.key(), seq });
            continue;
        }

        // ---- işlem anındaki NAV ile fiyatla ----
        let nav = pool_senior_nav(&ctx.accounts.pool)?;
        let (gross, fee, net) = withdraw_quote(
            req.shares,
            ctx.accounts.pool.entry_exit_fee_bps,
            ctx.accounts.pool.total_shares,
            nav,
        )?;
        if net > ctx.accounts.pool.idle_cash {
            out_of_cash = true;
            break; // FIFO: sonraki talepler de beklesin
        }

        if net > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: dest_ai.clone(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    signer_seeds,
                ),
                net,
            )?;
        }
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    from: ctx.accounts.share_escrow.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                signer_seeds,
            ),
            req.shares,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.idle_cash = pool.idle_cash.checked_sub(net).ok_or(GlassError::InvariantViolation)?;
        pool.total_shares = pool
            .total_shares
            .checked_sub(req.shares)
            .ok_or(GlassError::InvariantViolation)?;
        pool.withdraw_head = seq + 1;

        emit!(WithdrawProcessed {
            pool: pool_key,
            request: req_ai.key(),
            owner: req.owner,
            seq,
            shares: req.shares,
            gross,
            fee,
            net,
        });
        req.close(owner_ai.clone())?;
        processed += 1;
    }

    if processed == 0 && skipped == 0 {
        require!(!out_of_cash, GlassError::InsufficientIdleCash);
        return err!(GlassError::WithdrawQueueEmpty);
    }

    // ---- invariant'lar ----
    ctx.accounts.vault.reload()?;
    ctx.accounts.share_mint.reload()?;
    assert_vault_covers_idle(ctx.accounts.vault.amount, ctx.accounts.pool.idle_cash)?;
    require!(
        ctx.accounts.share_mint.supply <= ctx.accounts.pool.total_shares,
        GlassError::InvariantViolation
    );
    Ok(())
}
