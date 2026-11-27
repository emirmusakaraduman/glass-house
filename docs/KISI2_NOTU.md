# Kişi 2 için not (Backend A → Backend B)

Tarih: 26 Kasım 2026. Backend A tarafında `create_pool`, `fund_first_loss`, `deposit`,
`apply_loan`, `approve_loan`, `fund_loan`, `confirm_title`, `cancel_funding` bitti ve test
edildi (51 TS testi, 27 Rust testi). Alan listesi ve imzalar `docs/STATE.md`'de.

## 1. Davranışını etkileyen DEĞİŞİKLİK (önce bunu oku)

Güvenlik denetiminde iki invariant'ın saldırıya açık olduğu bulundu ve değiştirildi:

**a) Escrow: `==` yerine `>=`.** `nav::assert_escrow_matches` artık yok; adı
`nav::assert_escrow_covers(escrow_amount, expected)` ve kontrol `escrow_amount >= expected`.
Sebep: bir token hesabına herkes imzasız transfer yapabilir. 1 micro-USDC bağış, `==` ile
LoanEscrow/CollateralEscrow'u kilitliyordu (iade dahil).
Senin için kural:
- Escrow'dan yalnızca **beklenen tutarı** hesaba kat. Token bakiyesinden sayaç türetme.
- İade/iptalde escrow'un **gerçek bakiyesi** borçluya gider (fazlalık dahil).
- Kendi instruction'larında da escrow kontrolünde `==` kullanma.

**b) Pay arzı: `share_mint.supply <= pool.total_shares`** (eskiden `==`). Pay sahibi kendi
paylarını SPL `burn` ile yakabilir; `==` bunu tüm yatırımlar için kilitliyordu.
Senin için kural:
- `process_withdrawals` payı program içinden yakıp `total_shares`'ı **aynı miktar** düşürmeli.
- `total_shares` hiçbir zaman `supply`'dan küçük olmamalı.

## 2. Kullanabileceğin hazır parçalar

- `math.rs`: `installment`, `interest_for_period`, `split_payment`, `final_installment`,
  `split_interest`, `origination_fee`, `collateral_amount` (imzalar STATE.md'de).
- `nav.rs`: `pool_senior_nav`, `deposit_quote`, `withdraw_quote`, `assert_vault_covers_idle`,
  `assert_escrow_covers`, `loan_escrow_expected`.
- `approve_loan::check_ltv(loan, appraised_value, max_ltv_bps)` public.
- `tests/helpers/loanMath.ts`: TS karşılıkları (Rust ile aynı micro değerler).

## 3. Kredi yaşam döngüsü, senin başlangıç noktan

Backend A'nın bıraktığı durum (`confirm_title` sonrası):
- `Loan.status = Active`, `next_due = onay anı + period_seconds`, `paid_installments = 0`,
  `missed_installments = 0`, `remaining_principal = principal`, `late_fee_accrued = 0`,
  `last_processed_period = 0`.
- `Pool.total_outstanding` fonlamada artmış durumda; `idle_cash` düşmüş.
- `Pool.reserve_balance` ücretin yarısı kadar artmış, `reserve_pending` sıfırlanmış.
- **CollateralEscrow** 3 × taksit ile dolu ve açık (authority Pool PDA); `crank_loan` /
  `repay` bunu kullanacak.
- **LoanEscrow** 0 bakiye ile açık kalıyor (bağış varsa fazlalık içerir). Kapatmak istersen
  söyle, `confirm_title`'a eklerim.
- Tüm escrow/vault token hesaplarının authority'si **Pool PDA**; yani her instruction'da
  escrow'u `seeds = [ESCROW_SEED / COLLATERAL_SEED, loan]` + `bump = loan.*_bump` ile sabitle.
  Biri atlanırsa havuzun parası açılır.

## 4. Test yazarken

- `tests/glasshouse.ts`'te `approvedLoan`, `fund`, `confirm`, `cancel`, `mkPool` yardımcıları
  var ama `describe` içinde yerel; ihtiyacın olursa ortak bir `tests/helpers/` dosyasına
  çıkarmamı iste.
- `BrakeLateRatio` yalnızca `Pool.late_default_principal > 0` iken tetiklenir; bu sayacı
  yalnızca senin `crank_loan`'ın artırıyor. Bu fren testi sende.
- `fund_loan`'daki `AppraisalTooLow` zincirden ulaşılamaz (`approve_loan` zaten engelliyor).
- Zaman testleri için `title_timeout_seconds` kısa (2 sn) bir havuz kurulabiliyor.

## 5. Hâlâ cevap beklenen noktalar

`docs/STATE.md` sonundaki "Kılavuzdan sapmalar" listesi onayın bekliyor:
`Pool.platform_treasury`, `Pool.usdc_mint`, `Loan.income_ok`, `Loan.currency_ok`,
`Loan.escrow_bump`, `Loan.collateral_bump`, `PoolStatus {Active, Paused}`.
Bunlardan biri sana sorun çıkarıyorsa Cuma öğlenden önce söyle; sonrasında IDL dondurulur.
