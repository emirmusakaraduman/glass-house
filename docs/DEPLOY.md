# Devnet deploy rehberi (P12)

Bu dosyadaki deploy komutlarının **hiçbiri çalıştırılmadı** (devnet'e henüz yazılmadı). Zincire yazan adımlar (deploy, mint,
SOL transferi, havuz kurulumu) CLAUDE.md gereği önce gösterilir, **onay sonrası** çalıştırılır.
Scriptler varsayılan olarak dry-run'dır; zincire yalnızca `--execute` ile yazar.

## 0. Önkoşullar (karar/bilgi gerekir)

1. **Deployer cüzdanı:** WSL `~/.config/solana/devnet-deployer.json`
   (adres `9eXnNLKLWoYtudMauLcFP2bdR57JFT5LDPQv1PB1RnyV`). Yalnızca devnet içindir; dosyayı
   paylaşma ve yedekle (kaybolursa programı güncelleyemezsin).
2. **Program upgrade alanı (`--max-len`).** Varsayılan deploy yalnızca mevcut boyut kadar alan
   ayırır; daha büyük bir sürüm sonradan YÜKLENEMEZ. Kişi 2'nin 6 gövdesi eklenince program
   büyüyecek (şu an 689.320 bayt, gövdeler boş). Öneri: `--max-len 1000000`.
3. **Program ID anahtarı** `target/deploy/glasshouse-keypair.json` yedeklenmiş olmalı
   (`.gitignore`'da, repoya girmez).
4. **Hangi binary gider:** `npm run build` çıktısı `target/deploy/glasshouse.so`
   (Solana **4.4.1**, `--arch v0`, ELF e_flags `0x0` = SBPF v0; 6 gövdenin hepsi dahil).
   Üç test takımı bu binary'ye karşı geçti: 50 Rust, 46 LiteSVM, 63 yerel-validator.
   Boyut 690.128 bayt, sha256 `fce6cadfcee51e66ebab5b12a66b16da14dd6935ef28314d5a79596abfafe24a`
   (yeniden derlenirse değişir; deploy öncesi tekrar doğrula). Deploy sonrası
   `solana program dump <id> dump.so --url devnet` ile çekip sha256'yı karşılaştır.

**Gerçek kira (`solana rent`, devnet):** 689.320 bayt = 3,50 SOL; 800.000 = 4,06 SOL;
1.000.000 = 5,08 SOL. Deploy sırasında geçici buffer hesabı da kira tutar (sonra iade edilir),
yani tepe ihtiyaç yaklaşık buffer + programdata kirasıdır (1 MB için ≈ 8,6 SOL; bu kısım tahmin).
Ek olarak demo cüzdanları ≈ 2,9 SOL ve gövdeler gelince program güncellemesi için ≈ 4 SOL geçici
buffer. Toplamda en az ≈ 12 SOL önerilir.

## 1. Derleme (WSL, zincire yazmaz)

```bash
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash <betik>   # betik: PATH + cd /mnt/c/projeler/glasshouse
anchor build
```

## 2. Program deploy (ZİNCİRE YAZAR, onay gerekir)

```bash
solana config set --url devnet
solana balance                                   # deployer bakiyesini kontrol et
solana program deploy target/deploy/glasshouse.so \
  --program-id target/deploy/glasshouse-keypair.json \
  --max-len 1000000 \
  --keypair <deployer.json> --url devnet
solana program show HLKhCx1dFCCH3oTaaQEBEXZ5PShftueTFTEmKVZFyrP2 --url devnet
```

`--max-len` kontrolü için `solana program deploy` kullanıyoruz (`anchor deploy` yerine).

IDL'i zincire yüklemek (opsiyonel, frontend dosyadan okuyorsa gerekmez):
`anchor idl init HLKh... -f target/idl/glasshouse.json --provider.cluster devnet --provider.wallet <deployer.json>`

## 3. Demo kurulumu (ZİNCİRE YAZAR; her biri önce dry-run)

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=<deployer.json>

yarn deploy:usdc                       # dry-run: 6 decimal mock USDC mint'i
yarn deploy:usdc --execute

yarn deploy:wallets                    # dry-run: 10 cüzdan, SOL, USDC hesapları, USDC basımı
yarn deploy:wallets --execute          # anahtarlar .keys/ içine yazılır (paylaşma!)

yarn deploy:pools --first-loss 10000   # dry-run: ev + araç havuzu, her birine 10.000 USDC ilk zarar kasası
yarn deploy:pools --first-loss 10000 --execute
```

`deployments/devnet.json` her adımda güncellenir (program, mint, cüzdan adresleri, pool/vault
adresleri). Gizli anahtarlar yalnızca `.keys/` içindedir.

İlk zarar kasası notu: `fund_loan` kuralı `first_loss_balance ≥ %5 × (outstanding + principal)`.
Maria örneği (70.000) için en az 3.500; 7M'lik havuz için 350.000. Platform cüzdanına 50.000
USDC basılır; demo için `--first-loss 10000` yeterli.

## 4. IDL ve tipleri teslim (zincire yazmaz)

```bash
yarn idl:export
```

`deployments/idl/glasshouse.json` ve `glasshouse.ts` üretilir. **Her yeniden derlemeden sonra
tekrar çalıştır** (özellikle Kişi 2'nin instruction'ları eklenince). Frontend'in beklediği hedef
klasör henüz belli değil; Kişi 3 söyleyince kopyalanır.

## 5. Demo cüzdan kadrosu (10)

| Rol | Görev |
|---|---|
| investorA, investorB | yatırımcılar (500.000 USDC) |
| borrowerMaria, borrowerDiego | alıcılar (ev / araç) |
| seller | satıcı |
| underwriter | `approve_loan` |
| titleAgent | `confirm_title` |
| platform | pool admin, hazine, `record_recovery` ikinci imzacısı (`co_signer`) |
| recoveryAgent | `pool.recovery_agent`; satış geliri bu cüzdanın USDC hesabından çıkar (100.000 USDC basılır) |
| crank | yabancı çağıran (fund_loan / crank) |

## 6. Varsayımlar (değiştirilecekse söyle)

- `recovery_agent` = ayrı `recoveryAgent` cüzdanı (10. cüzdan) ve `min_recovery_bps = 5000`
  (3 havuzda da): satış geliri `appraised_value × %50` altındaysa `record_recovery` ikinci imza
  ister, `co_signer == pool.admin` (platform). İkisi de `create_pool` sonrası değişmez.
- `title_timeout_seconds` = 3600 (demo `period` 60 sn; tescil süresi için ürün değeri tanımsız).
- Araç havuzu (P13) eklendi: %60 / %9 / 60 ay / 5400. Karşılık, fren, tampon ve ücret değerleri
  ev ile aynı varsayıldı (kılavuz araç için ayrı değer vermiyor).
- `--first-loss` her iki havuza da aynı tutarı yatırır; araç için 600 USDC (Diego) yeterli,
  platform bakiyesi (50.000) iki havuza 10.000 + 10.000 için yeter.
- 2008 modu (P14) eklendi: `pools.crisis2008` (pool_id 3, ev faiz/vade/katsayı; max_ltv %97,
  min_first_loss 0, brake_reserve 0). "reserve 0" ifadesini `brake_reserve_bps = 0` olarak
  yorumladım (yedek fon boşken yedek fon freni kredi durdurmasın). Bu havuza `--first-loss`
  yatırılmaz. Adresi `deployments/devnet.json` içinde, Kişi 2'nin stres simülasyonu için.
