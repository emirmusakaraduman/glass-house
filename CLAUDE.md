# CLAUDE.md — GlassHouse (Backend A)

Bu dosya, GlassHouse reposunda çalışan Claude için kalıcı talimatlardır. Kaynak doküman: `GlassHouse v4 — Solana'da Şeffaf Ev ve Araç Kredisi`.

## Kesin kurallar

- **git commit, git push, branch açma, rebase YAPMA.** Kullanıcı açıkça "commit at" / "pushla" demedikçe yalnızca dosyaları düzenle. Her işin sonunda değişen dosyaların listesini ver.
- Devnet deploy, airdrop, mint gibi zincire yazan komutları önce göster, kullanıcı onaylayınca çalıştır.
- Kapsam: Backend A (para akışı). Kişi 2'nin (Backend B) ve Kişi 3'ün (Frontend) dosyalarına dokunma; ortak arayüz değişecekse önce söyle ve `docs/STATE.md`'yi güncelle.
- "12 yarım instruction yerine 12 sağlam instruction": her instruction testle birlikte biter.
- Zincire kişisel veri yazılmaz: isim, adres, ilan URL'si, şasi/plaka no, tapu no yok. Yalnızca tuzlu hash, değer bandı, şehir düzeyi bölge kodu.

## Proje özeti

GlassHouse, geliri USDC olan alıcıları (dolarize ekonomiler) doğrulanmış yatırımcılarla buluşturan Solana kredi protokolüdür. İki izole havuz tek Anchor programından `create_pool` ile kurulur:

| Parametre | Ev | Araç |
|---|---|---|
| max LTV | %70 | %60 |
| Faiz (sabit) | %7 | %9 |
| Vade | 240 ay | 60 ay |
| recovery_coeff_bps | 6300 | 5400 |
| Faiz bölüşümü | %6 havuz / %0,5 platform / %0,5 yedek | %8 / %0,5 / %0,5 |

Zarar sırası: borçlu teminatı → satış geliri → (stretch) underwriter stake → FirstLossVault (≥ kalan anaparanın %5'i) → Reserve → senior yatırımcı.

Hackathon: Dev3pack Global, 27–29 Kasım 2026. Solana devnet. Açık kaynak (MIT). Video < 3 dk.

## Backend A sorumlulukları

1. Instruction'lar: `create_pool` (parametre sınırları + değişmezlik), `fund_first_loss`, `deposit`, `apply_loan`, `approve_loan`, `fund_loan`, `confirm_title` (+ opsiyonel `cancel_funding`).
2. Altyapı: `state.rs` (Pool, Loan), `math.rs` (sabit nokta faiz), `nav.rs` (NAV, pay fiyatı, invariant). **İlk iş olarak dondurulur**; Kişi 2 fixture'larını bunlara göre yazar.
3. Devnet deploy + IDL'in frontend'e teslimi (Cuma öğlene kadar).
4. Araç havuzu: `asset_type` parametresi ve havuz kurulumu (Cuma 18:00 sonrası, ev akışı yeşilse).
5. Sunum: README birleştirme, LICENSE, hukuki metinler, takım bölümü, teslim formu.

Kişi 2 (Backend B): `repay`, `payoff`, `request_withdraw`, `process_withdrawals` (N=3), `crank_loan`, `record_recovery`, risk mantığı, tüm testler, stres simülasyonu, seed script. `math.rs` ve `nav.rs`'yi kullanır.

## Hesaplar (PDA)

| Hesap | Seed |
|---|---|
| Pool | `["pool", admin, pool_id]` |
| Vault | `["vault", pool]` |
| FirstLossVault | `["first_loss", pool]` |
| Reserve | `["reserve", pool]` |
| ShareMint | `["shares", pool]` (mint authority = pool PDA) |
| WithdrawRequest | `["wreq", pool, seq]` |
| Loan | `["loan", pool, next_loan_id]` (id borçludan değil havuz sayacından) |
| LoanEscrow | `["escrow", loan]` |
| CollateralEscrow | `["collateral", loan]` |

Pool ve Loan struct'larında Kişi 2 için 64 byte reserved padding bulunur. Alan listesi ve birimler `docs/STATE.md`'de.

## Kredi durumları

`Pending → Approved → Funded → Active → PaidOff`
Sapmalar: `Pending → Rejected` (approve_loan, decision = Reject), `Funded → Cancelled` (tescil süresi aşımı, cancel_funding), `Active → Late1 → Late2 → (Active | Defaulted → Recovered)`.

Hata kodları (errors.rs) en az şunları içerir: `Unauthorized`, `InvalidStatus`, `SellerIsBorrower`, `InsufficientDownPayment`, `AppraisalTooLow`, `LiquidityBufferBreached`, `BrakeLateRatio`, `BrakeReserve`, `InsufficientFirstLoss`, `ParamOutOfBounds`, `MathOverflow`, `TitleDeadlinePassed`, `TitleDeadlineNotReached`, `InvariantViolation`, `ZeroAmount`.

## Birimler ve matematik

- USDC 6 decimal; tüm tutarlar micro-USDC (`u64`). Oranlar bps (`u16`/`u32`). Zaman saniye (`i64`, Solana Clock).
- Sabit nokta: 1e18 ölçekli `u128`, her işlem `checked_*`. İki ölçekli sayının çarpımı için **U256 ara değerli `mul_div`** kullan (`uint` crate; bkz. karar 3).
- `(1+r)^n` kare alarak üs alma ile. Taksit: `M = P·r·x/(x−1)`, `x=(1+r)^n`. Aylık faiz `kalan × r`, micro-USDC'ye yuvarlanır.
- Yuvarlama protokol lehine: borçludan alınan yukarı, borçluya/yatırımcıya verilen aşağı. Faiz bölüşümü küsuratı yatırımcı payına.
- Son taksit `kalan anapara + faiz` → kredi tam sıfırla kapanır.
- Referans değerler (testlerde kullan): Maria 70.000 / %7 / 240 → 542,71; ilk ay faiz 408,33. Diego 12.000 / %9 / 60 → 249,10; ilk ay faiz 90,00. f: ev 0,007753, araç 0,020758.

## NAV ve paylar

```
senior_nav = idle_cash + total_outstanding − max(0, loss_provision − first_loss_balance − reserve_balance)
share_price = senior_nav / total_shares
```
- NAV içsel sayaçlardan hesaplanır, vault bakiyesinden değil (bağış saldırısına karşı).
- Pay basımında sanal pay ofseti. Giriş/çıkış ücreti (`entry_exit_fee_bps`, varsayım %0,2).

## Güvenlik kontrol listesi (her instruction)

- Rol kontrolü `has_one` (underwriter, title_agent, recovery_agent, admin); signer kontrolleri.
- `apply_loan`: borrower ve seller birlikte imzalar, `seller != borrower`.
- Token account'larda mint, owner, authority constraint'leri; PDA seed + bump doğrulaması; reinit yok.
- Her instruction sonunda `assert_invariants`: `vault.amount ≥ pool.idle_cash`, escrow bakiyesi == loan sayaçları.
- `create_pool` sonrası parametreler değişmez; sınırlar 2008 modunu (LTV %97, first_loss 0) da kabul eder.
- Durum geçişleri yalnızca yukarıdaki diyagrama göre.

## `fund_loan` kuralları

- **Çağıran: herkes (permissionless).** Tüm koşullar zincirde kontrol edildiği ve para yalnızca vault → LoanEscrow'a gittiği için imzacının yetkisi gerekmez; çağıran sadece tx ücretini öder.
- Durum `Approved`.
- `principal ≤ max_ltv × min(price, appraised_value)`; değilse `AppraisalTooLow` (approve_loan'da da kontrol edilir, burada tekrar edilir).
- Fonlama sonrası `idle_cash − principal ≥ buffer_bps × senior_nav` (%10 likidite tamponu).
- Gecikme freni: `total_outstanding > 0` ise `late_default_principal × 10000 ≤ brake_late_bps × total_outstanding` (%10).
- Yedek fon freni: `reserve_balance + reserve_pending ≥ brake_reserve_bps × total_outstanding` (yeni kredi hariç), `brake_reserve_bps = 25` (%0,25).
- İlk zarar kuralı: `first_loss_balance ≥ min_first_loss_bps × (total_outstanding + principal)` (%5; 2008 modunda 0).
- Ücretin yedek fon yarısı (`fee/2`) `reserve_pending` sayacına yazılır; token hâlâ escrow'dadır.

## Alınan tasarım kararları

Bunlar takımla tartışılmadan Claude'un seçtiği varsayımlardır; README'de "tasarım kararları" başlığında yazılır. Değiştirmek gerekirse önce bu bölüm güncellenir.

1. **Yedek fon freni ilk kredide tetiklenmesin.** Eşik %1 yerine **%0,25** (`brake_reserve_bps = 25`). Açılış ücretinden gelen %0,5 bu eşiği iki kat karşılar; stres tablosundaki 35k/7M = %0,5 ile tutarlıdır. Fonlanmış ama tescili onaylanmamış kredilerin yedek fon payı için `Pool.reserve_pending` sayacı tutulur: `fund_loan` artırır, `confirm_title` token'ı Reserve'e taşıyıp sayacı `reserve_balance`'a aktarır, `cancel_funding` azaltır. Fren `reserve_balance + reserve_pending` ile hesaplanır; NAV yalnızca `reserve_balance`'ı kullanır. Temerrütlerle yedek fon eridikçe fren yine çalışır.
2. **Parametre sınırları güvenlik aralığıdır, ürün değeri değildir.** `create_pool` sınırları: `max_ltv_bps ≤ 9700`, `rate_bps 1..=2000`, `term_months 1..=360`, `recovery_coeff_bps ≤ 10000`, `provision_bps` artan ve ≤ 10000, `buffer_bps ≤ 5000`, `min_first_loss_bps ≤ 10000`, `brake_*` ≤ 10000, `period_seconds ≥ 1`, `grace_seconds < period_seconds`, `entry_exit_fee_bps ≤ 100`. Ürün değerleri (ev %70/%7/240, araç %60/%9/60) `scripts/create-pools.ts`'te sabit; 2008 modu (`max_ltv 9700`, `min_first_loss 0`) aynı sınırlardan geçer. Ayrıca `create_pool` sınırların uç noktasında `installment(1_000_000, rate, term)` hesaplayarak taşma olmadığını doğrular.
3. **Taşmaya karşı U256.** `uint` crate'iyle (`construct_uint! { pub struct U256(4); }`) `mul_div(a, b, d)` yazılır; ölçekli iki sayının her çarpımı ve `P·r·x/(x−1)` bu fonksiyondan geçer. Sonuç `u128`/`u64`'e `try_from` ile döner, sığmazsa `MathOverflow`.
4. **Ekspertiz fiyattan düşükse kredi reddedilir, küçültülmez.** `approve_loan` LTV'yi `min(price, appraised_value)` üzerinden kontrol eder; sığmıyorsa onay verilemez (`AppraisalTooLow`). Underwriter `decision = Reject` ile reddeder, alıcı daha yüksek peşinatla yeniden başvurur. `fund_loan` aynı kontrolü tekrar yapar. `top_up_escrow` stretch olarak kalır.
5. **`Approved` durumu eklendi, reddetme ayrı instruction değil.** `approve_loan(decision: Approve | Reject, ...)`: Approve → `Pending → Approved` ve değer/hash alanları yazılır; Reject → `Pending → Rejected`, LoanEscrow (peşinat + ücret) ve CollateralEscrow borçluya iade edilir, token hesapları kapatılıp rent borçluya döner. Instruction sayısı değişmez.
6. **`fund_loan` permissionless.** Gerekçe: yukarıdaki kurallar zincirde; underwriter onayı zaten `Approved` durumunda kayıtlı. Bu, "kurallar kodda" anlatısıyla ve izinsiz crank'le tutarlı; demo'da da bir imzacı azalır. %5 ilk zarar kasası kuralı `fund_loan`'a eklendi.

## Demo parametreleri

`period_seconds = 60`, `grace_seconds = 10`. Devnet'te 9 cüzdan (2 yatırımcı, 2 alıcı, 1 satıcı, 1 underwriter, 1 tescil ajanı, 1 platform, 1 yabancı crank). Mock USDC (6 decimal). Adresler `deployments/devnet.json`'da.

## Takvim

- Perş 26: state/math dondur, eksik instruction'lar.
- Cuma 27 öğlen: devnet deploy + IDL. 14:00 ev akışı uçtan uca. 18:00 sonrası araç havuzu.
- Cmt 28 22:00: özellik dondurma. Cmt akşam: README, LICENSE, hukuk metinleri.
- Pazar 29: programa dokunulmaz; teslim.
