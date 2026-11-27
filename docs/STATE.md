# STATE.md — GlassHouse hesap yapıları (DONDURULDU, v0.1)

Kaynak: `programs/glasshouse/src/state.rs`. Bu dosya ile kod çelişirse kod doğrudur;
yapı değişecekse **önce burası güncellenir ve Kişi 2 / Kişi 3'e haber verilir.**
Yeni alan gerekirse `reserved` (64 bayt) içinden ayrılır, mevcut alanların sırası/tipi değişmez.

## Birimler

| Ne | Birim |
|---|---|
| Tutar | micro-USDC, `u64` (1 USDC = 1_000_000) |
| Oran | bps, `u16` (%7 = 700) |
| Zaman | saniye, `i64` (Solana Clock `unix_timestamp`) |
| Sabit nokta | 1e18 ölçekli `u128` (yalnızca `math.rs` içinde) |
| Pay | `u64`, share mint 6 decimal |

## PDA seed'leri

| Hesap | Seed |
|---|---|
| Pool | `["pool", admin, pool_id (u64 LE)]` |
| Vault (token) | `["vault", pool]` |
| FirstLossVault (token) | `["first_loss", pool]` |
| Reserve (token) | `["reserve", pool]` |
| ShareMint | `["shares", pool]` (mint authority = pool PDA) |
| WithdrawRequest | `["wreq", pool, seq (u64 LE)]` |
| Loan | `["loan", pool, loan_id (u64 LE)]` (id havuz sayacından) |
| LoanEscrow (token) | `["escrow", loan]` |
| CollateralEscrow (token) | `["collateral", loan]` |

Vault, FirstLossVault, Reserve, LoanEscrow, CollateralEscrow token hesaplarının authority'si
ilgili Pool PDA'sıdır (LoanEscrow/CollateralEscrow için de Pool imzalar).

## Pool

| Alan | Tip | Not |
|---|---|---|
| admin | Pubkey | `fund_first_loss` yetkilisi |
| asset_type | enum AssetType {House, Vehicle} | |
| underwriter | Pubkey | `approve_loan` |
| title_agent | Pubkey | `confirm_title` |
| recovery_agent | Pubkey | `record_recovery` (Kişi 2) |
| usdc_mint | Pubkey | |
| platform_treasury | Pubkey | **EK** (kılavuz listesinde yok): açılış ücretinin platform yarısı buraya gider |
| pool_id | u64 | |
| max_ltv_bps | u16 | ev 7000, araç 6000 |
| rate_bps | u16 | ev 700, araç 900 |
| term_months | u16 | ev 240, araç 60 |
| recovery_coeff_bps | u16 | ev 6300, araç 5400 |
| grace_seconds | i64 | demo 10 |
| period_seconds | i64 | demo 60 |
| provision_bps | [u16; 4] | Karşılık oranı, kalan anapara üzerinden. İndeks: `[Active, Late1, Late2, Defaulted]` = ürün değeri `[0, 500, 1500, 1500]` (v4 s.8 tablosu). Defaulted girdisi TABAN'dır; gerçek karşılık `max(provision_bps[3]×kalan, kalan + birikmiş faiz − teminat − k×değer)`, k = recovery_coeff_bps (Kişi 2). `create_pool` kuralı: **azalmayan** ve ≤ 10000. |
| buffer_bps | u16 | likidite tamponu (1000 = %10) |
| brake_late_bps | u16 | gecikme freni (1000) |
| brake_reserve_bps | u16 | yedek fon freni, varsayılan **25** (karar 1) |
| min_first_loss_bps | u16 | 500 (2008 modunda 0) |
| entry_exit_fee_bps | u16 | varsayım 20 (%0,2), ≤ 100 |
| min_recovery_bps | u16 | Kişi 2 |
| title_timeout_seconds | i64 | tescil süresi |
| next_loan_id | u64 | |
| idle_cash | u64 | |
| total_outstanding | u64 | |
| late_default_principal | u64 | |
| loss_provision | u64 | |
| first_loss_balance | u64 | |
| reserve_balance | u64 | |
| reserve_pending | u64 | fren içindir, **NAV'a girmez** (karar 1) |
| total_shares | u64 | |
| withdraw_head / withdraw_tail | u64 | çekim kuyruğu (Kişi 2) |
| status | enum PoolStatus {Active, Paused} | |
| bump, vault_bump, first_loss_bump, reserve_bump, share_mint_bump | u8 | |
| reserved | [u8; 64] | Kişi 2 |

## Loan

| Alan | Tip | Not |
|---|---|---|
| id | u64 | havuz sayacından |
| pool, borrower, seller | Pubkey | |
| price | u64 | |
| appraised_value | u64 | `approve_loan` yazar |
| principal | u64 | `price − peşinat` |
| rate_bps | u16 | havuzdan kopyalanır |
| installment | u64 | `math::installment` |
| remaining_principal | u64 | |
| paid_installments, missed_installments | u16 | |
| next_due | i64 | |
| status | enum LoanStatus | aşağıda |
| doc_hash, asset_ref_hash | [u8; 32] | tuzlu hash; kişisel veri yok |
| value_band | u64 | ev 50k, araç 5k bant |
| region_code | u16 | şehir düzeyi |
| income_ok, currency_ok | bool | **EK**: `approve_loan` uyum bayrakları (P7) |
| provision_amount | u64 | Kişi 2 |
| late_fee_accrued | u64 | Kişi 2 |
| last_processed_period | u64 | Kişi 2 |
| funded_at, title_deadline | i64 | |
| bump, escrow_bump, collateral_bump | u8 | |
| reserved | [u8; 64] | Kişi 2 |

`LoanStatus`: `Pending, Approved, Rejected, Funded, Cancelled, Active, Late1, Late2, Defaulted, Recovered, PaidOff`

Geçişler: `Pending→Approved|Rejected`, `Approved→Funded`, `Funded→Active|Cancelled`,
`Active→Late1→Late2→(Active|Defaulted→Recovered)`, `Active→PaidOff`.

**`Loan.reserved` kullanımı (Kişi 2):** `reserved[0..8]` = `collateral_deducted` (u64 LE), crank'in
Late2 adımında CollateralEscrow'dan kestiği toplam tutar. Beklenen teminat = `3 × installment −
collateral_deducted`. Struct ve IDL değişmez; kalan 56 bayt boş. Kaynak: `lifecycle::state::loan_ext`.

Escrow tutarı kredi alanlarından türetilir (ayrı alan yok): peşinat = `price − principal`,
ücret = `origination_fee(principal)` (anaparanın %1'i, yukarı), teminat = `3 × installment`.

## Fonksiyon imzaları (Kişi 2 kullanır)

`math.rs` (hepsi `Result<_>`, taşmada `MathOverflow`):

```rust
mul_div(a: u128, b: u128, d: u128) -> u128            // floor, U256 ara değer
mul_div_up(a: u128, b: u128, d: u128) -> u128         // ceil
pow_scaled(base_1e18: u128, exp: u32) -> u128
monthly_rate(rate_bps: u16) -> u128                   // 1e18 ölçekli
installment(principal: u64, rate_bps: u16, term_months: u16) -> u64      // yukarı
interest_for_period(remaining: u64, rate_bps: u16) -> u64                // yukarı
split_payment(payment, remaining, rate_bps, late_fee_due) -> PaymentSplit
    // { late_fee, interest, principal, unapplied }; sıra: gecikme → faiz → anapara
final_installment(remaining: u64, rate_bps: u16) -> u64                  // kalan + faiz
split_interest(interest: u64, rate_bps: u16) -> (pool, platform, reserve) // küsurat havuza
origination_fee(principal) / max_principal(value, ltv_bps) / min_down_payment(price, ltv_bps)
collateral_amount(installment) -> u64
```

`nav.rs`:

```rust
senior_nav(idle_cash, total_outstanding, loss_provision, first_loss_balance, reserve_balance) -> u64
pool_senior_nav(&Pool) -> u64
share_price(nav, total_shares) -> u128                // 1e18 ölçekli, sanal ofsetli
shares_for_deposit(net_assets, total_shares, nav) -> u64    // aşağı; nav = işlemden ÖNCEKİ
assets_for_shares(shares, total_shares, nav) -> u64         // aşağı
entry_exit_fee(amount, fee_bps) -> u64                      // yukarı
deposit_quote(amount, fee_bps, total_shares, nav) -> (fee, shares)
withdraw_quote(shares, fee_bps, total_shares, nav) -> (gross, fee, net)
assert_vault_covers_idle(vault_amount, idle_cash)
loan_escrow_expected(status, price, principal) -> u64
assert_escrow_covers(escrow_amount, expected)           // escrow_amount >= expected (eşitlik DEĞİL, P10)
```

Her instruction sonunda `assert_vault_covers_idle` ve ilgili `assert_escrow_covers` çağrılır.

### Invariant semantiği (P10 sonrası DEĞİŞTİ, Kişi 2 dikkat)

- **Escrow: `bakiye >= beklenen`** (eskiden `==`; fonksiyon adı `assert_escrow_matches` idi,
  `assert_escrow_covers` oldu). Token hesabına herkes imzasız transfer yapabildiği için
  eşitlik kontrolü, 1 micro-USDC bağışla LoanEscrow/CollateralEscrow'u kilitlerdi (iade dahil).
  Kural: iade ve iptalde escrow'un **gerçek bakiyesi** borçluya gider (fazlalık dahil);
  `confirm_title` yalnızca beklenen tutarı öder, fazlalık escrow'da kalır.
  Kişi 2: kendi instruction'larında da escrow'dan yalnızca beklenen tutarı say, bakiyeye
  güvenip sayaç türetme.
- **Pay arzı: `share_mint.supply <= pool.total_shares`** (eskiden `==`). Pay sahibi kendi
  paylarını SPL `burn` ile yakabilir; eşitlik bunu tüm yatırımlar için DoS'a çevirirdi.
  Yakılan paylar `total_shares` sayacında kalır. Kişi 2: `process_withdrawals`
  `total_shares` ve supply'ı birlikte düşürmeli; sayaç hiçbir zaman supply'dan küçük olamaz.

Sanal ofset: `VIRTUAL_SHARES = VIRTUAL_ASSETS = 1_000_000`.
TypeScript karşılığı: `tests/helpers/loanMath.ts` (birebir BigInt; Rust testi ile aynı tam micro
değerlerini kilitler).

## Event'ler

`PoolCreated, FirstLossFunded, Deposited, LoanApplied, LoanApproved, LoanRejected, LoanFunded,
TitleConfirmed, FundingCancelled` — alanlar `events.rs`'de. Frontend bunları okur.

## Hata kodları

`Unauthorized, InvalidStatus, SellerIsBorrower, InsufficientDownPayment, AppraisalTooLow,
LiquidityBufferBreached, BrakeLateRatio, BrakeReserve, InsufficientFirstLoss, ParamOutOfBounds,
MathOverflow, TitleDeadlinePassed, TitleDeadlineNotReached, InvariantViolation, ZeroAmount`

Kişi 2 yaşam döngüsü hataları (6015 ve sonrası, bu sırayla; sıra değiştirilmez):
`LoanNotServiceable` (6015), `PeriodAlreadyProcessed` (6016), `RecoveryBelowFloor` (6017),
`WithdrawQueueEmpty` (6018), `InvalidWithdrawRequest` (6019), `InsufficientIdleCash` (6020),
`InvalidPaymentAmount` (6021), `InvalidCoSigner` (6022). İlk 15 varyant 6000–6014.

## Kılavuzdan sapmalar / eklenenler (onay bekliyor)

1. `Pool.platform_treasury` eklendi (confirm_title'da platform yarısının hedefi için gerekli).
2. `Loan.income_ok`, `Loan.currency_ok` eklendi (P7 "gelir ve para birimi uyum bayrakları").
3. `Loan.escrow_bump`, `Loan.collateral_bump` eklendi (PDA doğrulaması).
4. `Pool.usdc_mint` eklendi (mint constraint'leri için).
5. `PoolStatus {Active, Paused}` değerleri tasarım seçimi; kılavuz yalnızca `status` diyor.
