# Kişi 2 instruction imzaları (taslak v0.1)

Durum: Altı instruction derleniyor, gövdeler boş (`Ok(())`). Anchor 0.32.1 IDL'ine giriyor:
6 instruction, `WithdrawRequest` hesabı ve 7 event. Hesap listeleri ve argümanlar IDL dondurulana kadar sabit.

Dosyalar: `programs/glasshouse/src/instructions/{repay,payoff,request_withdraw,process_withdrawals,crank_loan,record_recovery}.rs`,
`programs/glasshouse/src/lifecycle/{mod,state,events,errors,provision,waterfall}.rs`

İşaretler: `*` yazılabilir, `!` imzacı, `?` opsiyonel. Pool / Loan / Vault / Reserve / FirstLoss / Collateral / ShareMint
hesapları STATE.md seed'leri ve kayıtlı bump'larla doğrulanır.

| Instruction | Argüman | Hesaplar (sırayla) | Yetki |
|---|---|---|---|
| `repay` | `amount: u64` | payer*! · pool* · loan* · payer_usdc* · vault* · reserve* · platform_treasury* · token_program | herkes (Blink) |
| `payoff` | — | borrower*! · pool* · loan* · borrower_usdc* · vault* · reserve* · platform_treasury* · collateral* · token_program | `loan.borrower` (has_one) |
| `request_withdraw` | `shares: u64` | owner*! · pool* · share_mint · owner_shares* · destination · share_escrow* (init_if_needed) · withdraw_request* (init) · token_program · system_program | pay sahibi |
| `process_withdrawals` | — | cranker! · pool* · vault* · share_mint* · share_escrow* · token_program · remaining: `[withdraw_request*, destination*, owner*] × N`, N ≤ 3 | herkes |
| `crank_loan` | — | cranker! · pool* · loan* · collateral* · vault* · reserve* · platform_treasury* · token_program | herkes |
| `record_recovery` | `proceeds: u64` | recovery_agent! · co_signer!? · pool* · loan* · recovery_source* · vault* · collateral* · first_loss* · reserve* · token_program | `pool.recovery_agent` (has_one); alt sınır altında + `co_signer == pool.admin` |

## Yeni hesap ve seed'ler (Kişi 2 modülünde, ortak state.rs'e dokunmaz)

| Hesap | Seed | Alanlar |
|---|---|---|
| `WithdrawRequest` | `["wreq", pool, pool.withdraw_tail (u64 LE)]` | pool, owner, destination, seq: u64, shares: u64, created_at: i64, bump: u8 |
| share_escrow (token) | `["share_escrow", pool]` | mint = ShareMint, authority = Pool PDA; kilitli paylar burada durur |

## Event'ler (`lifecycle/events.rs`)

`LoanRepaid, LoanPaidOff, LoanCranked, RecoveryRecorded, WithdrawRequested, WithdrawProcessed, WithdrawSkipped`

## Kararlar (Kişi 1 ile)

1. **`pool.platform_treasury`** bir USDC token hesabının adresidir
   (`address = pool.platform_treasury, token::mint = pool.usdc_mint`) — confirm_title ile aynı.
2. **Hata kodları** ortak `errors.rs`'te: `GlassError` 6015–6022 (`LoanNotServiceable, PeriodAlreadyProcessed,
   RecoveryBelowFloor, WithdrawQueueEmpty, InvalidWithdrawRequest, InsufficientIdleCash, InvalidPaymentAmount,
   InvalidCoSigner`). Ayrı `LifecycleError` enum'u kaldırıldı.
3. **`provision_bps`** = `[Active, Late1, Late2, Defaulted taban]`, ürün değeri `[0, 500, 1500, 1500]`.

## `Loan.reserved` kullanımı (STATE.md'ye eklenmeli)

STATE.md'de `Loan.reserved [u8; 64]` Kişi 2'ye ayrılmış. Struct ve IDL değişmez; yalnızca baytların anlamı:

| Bayt | Alan | Tip | Anlam |
|---|---|---|---|
| 0..8 | `collateral_deducted` | u64 LE | crank'in CollateralEscrow'dan kestiği toplam (Late2 adımı) |
| 8..64 | — | 0 | boş |

Neden: Late2'deki kredi ödeyip Active'e dönünce teminat 2 taksitte kalır; bu açık `last_processed_period`'dan
türetilemez. Erişim: `lifecycle::state::loan_ext::{collateral_deducted, set_collateral_deducted}`.
Beklenen teminat = `3 × installment − collateral_deducted`. Frontend teminat göstergesi için aynı formülü kullanabilir.

## Davranış notları (frontend için)

- `crank_loan`: yeni adım yoksa `PeriodAlreadyProcessed` (6016) döner.
- `repay`: bir çağrı en fazla bir dönem kapatır (gecikme bedeli tam + faiz/anapara ≥ taksit). Kısmi ödeme borca
  uygulanır ama vadeyi ilerletmez. Üst sınır `late_fee_accrued + kalan + dönem faizi`; fazlası `InvalidPaymentAmount`.
  Gecikmedeki kredi vadesi geçmiş taksidi kalmayınca Active'e döner. Son ödemede PaidOff; teminat iadesi `payoff`'ta.

- `request_withdraw`: paylar `share_escrow`'a kilitlenir; hesap ilk talepte oluşur (o zamana kadar
  `process_withdrawals` hesap kontrolünde `AccountNotInitialized` ile düşer — frontend `withdraw_head < withdraw_tail`
  değilse çağırmamalı).
- `process_withdrawals`: işlem anındaki NAV ile öder (talep anındaki değil), payları yakar, `total_shares`'ı aynı
  miktar düşürür, talep hesabını kapatır (kira sahibine). Çıkış ücreti (`entry_exit_fee_bps`) havuzda kalır.
  Nakit yetmezse `InsufficientIdleCash`, talep sırada kalır. Ödeme hesabı kapatılmış/dondurulmuş talep atlanır
  (`WithdrawSkipped`); payları kilitli kalır — geri alma instruction'ı yok (bilinen sınır).
  remaining_accounts: `[withdraw_request, destination, owner] × N`, N ≤ 3, kuyruk sırasıyla.

## lifecycle/ modülü

| Dosya | İçerik |
|---|---|
| `state.rs` | `WithdrawRequest` hesabı (seed: senin `WITHDRAW_REQUEST_SEED`), `share_escrow` seed'i |
| `events.rs` | 7 event |
| `schedule.rs` | kaçırılan taksit (Clock'tan), crank adımları (idempotent), %2 gecikme bedeli — saf fonksiyonlar + testler |
| `provision.rs` | karşılık kademeleri, Defaulted formülü, havuz toplamı farkı — saf fonksiyonlar + testler |
| `waterfall.rs` | zarar sırası (teminat → gelir → FirstLoss → Reserve → senior) — saf fonksiyon + PDF stres tablosu testleri |

Bu modüller yalnızca `crate::errors::GlassError`, `crate::constants::*` ve
`crate::state::{LoanStatus, Pool, Loan}` kullanır. Senin kodunla (kisi2-paket) derlendi ve test edildi.

## ORTAK DOSYA NOTU — senin kuralınla (`<ad>_handler`, mod.rs'de `pub use`)

Kopyalanacaklar: `src/instructions/` altına 6 dosya, `src/lifecycle/` klasörünün tamamı.

`instructions/mod.rs` (mevcut satırların altına):

```rust
pub mod crank_loan;
pub mod payoff;
pub mod process_withdrawals;
pub mod record_recovery;
pub mod repay;
pub mod request_withdraw;

pub use crank_loan::*;
pub use payoff::*;
pub use process_withdrawals::*;
pub use record_recovery::*;
pub use repay::*;
pub use request_withdraw::*;
```

`lib.rs` mod bildirimlerine:

```rust
pub mod lifecycle;
```

`#[program] mod glasshouse` içinde `fund_first_loss`'tan sonra:

```rust
pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
    instructions::repay::repay_handler(ctx, amount)
}

pub fn payoff(ctx: Context<Payoff>) -> Result<()> {
    instructions::payoff::payoff_handler(ctx)
}

pub fn request_withdraw(ctx: Context<RequestWithdraw>, shares: u64) -> Result<()> {
    instructions::request_withdraw::request_withdraw_handler(ctx, shares)
}

pub fn process_withdrawals<'info>(
    ctx: Context<'_, '_, 'info, 'info, ProcessWithdrawals<'info>>,
) -> Result<()> {
    instructions::process_withdrawals::process_withdrawals_handler(ctx)
}

pub fn crank_loan(ctx: Context<CrankLoan>) -> Result<()> {
    instructions::crank_loan::crank_loan_handler(ctx)
}

pub fn record_recovery(ctx: Context<RecordRecovery>, proceeds: u64) -> Result<()> {
    instructions::record_recovery::record_recovery_handler(ctx, proceeds)
}
```

Bu satırlar bende yerel kopyada aynen var; `lib.rs` / `mod.rs`'in geri kalanı seninkiyle aynı.
