# Devnet deploy rehberi (P12)

Bu dosyadaki komutların **hiçbiri çalıştırılmadı**. Zincire yazan adımlar (deploy, mint,
SOL transferi, havuz kurulumu) CLAUDE.md gereği önce gösterilir, **onay sonrası** çalıştırılır.
Scriptler varsayılan olarak dry-run'dır; zincire yalnızca `--execute` ile yazar.

## 0. Önkoşullar (karar/bilgi gerekir)

1. **Deployer cüzdanı.** WSL'deki `~/.config/solana/id.json` yalnızca yerel test cüzdanıdır.
   Devnet için SOL'ü olan bir cüzdan gerekir (aşağıdaki maliyet tahmini). Hangisi kullanılacak?
2. **Program upgrade alanı (`--max-len`).** Program şu an ~567 KB. Kişi 2'nin 6 instruction'ı
   eklenince büyüyecek; varsayılan deploy yalnızca mevcut boyut kadar alan ayırır, daha büyük
   bir sürüm sonradan YÜKLENEMEZ. Baştan geniş alan ayırmak kirayı artırır. Öneri: `1000000` (1 MB).
3. **Program ID anahtarı** `target/deploy/glasshouse-keypair.json` yedeklenmiş olmalı
   (kaybolursa aynı adrese deploy/upgrade yapılamaz). `.gitignore`'a eklendi, repoya girmez.

**Maliyet tahmini (kesin değil, deploy öncesi `solana rent` ile doğrula):** program hesabı kirası
boyuta göre kabaca 0,0000070 SOL/bayt: 567 KB ≈ 4 SOL, 1 MB ≈ 7 SOL. Deploy sırasında geçici
buffer hesabı için aynı miktar bir süre daha bloke olur (sonra iade edilir), yani tepe ihtiyaç
yaklaşık 2 katıdır. Ek olarak demo cüzdanları için ≈ 2,5 SOL (create-wallets.ts hedefleri).
Devnet airdrop istek başına sınırlıdır; yetmezse faucet gerekir.

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

yarn deploy:wallets                    # dry-run: 9 cüzdan, SOL, USDC hesapları, USDC basımı
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

## 5. Demo cüzdan kadrosu (9)

| Rol | Görev |
|---|---|
| investorA, investorB | yatırımcılar (500.000 USDC) |
| borrowerMaria, borrowerDiego | alıcılar (ev / araç) |
| seller | satıcı |
| underwriter | `approve_loan` |
| titleAgent | `confirm_title` |
| platform | pool admin, hazine, recovery_agent |
| crank | yabancı çağıran (fund_loan / crank) |

## 6. Varsayımlar (değiştirilecekse söyle)

- `recovery_agent` = platform cüzdanı (9 cüzdanlık kadroda ayrı rol yok).
- `title_timeout_seconds` = 3600 (demo `period` 60 sn; tescil süresi için ürün değeri tanımsız).
- `min_recovery_bps` = 0.
- Araç havuzu (P13) eklendi: %60 / %9 / 60 ay / 5400. Karşılık, fren, tampon ve ücret değerleri
  ev ile aynı varsayıldı (kılavuz araç için ayrı değer vermiyor).
- `--first-loss` her iki havuza da aynı tutarı yatırır; araç için 600 USDC (Diego) yeterli,
  platform bakiyesi (50.000) iki havuza 10.000 + 10.000 için yeter.
- 2008 modu (P14) eklendi: `pools.crisis2008` (pool_id 3, ev faiz/vade/katsayı; max_ltv %97,
  min_first_loss 0, brake_reserve 0). "reserve 0" ifadesini `brake_reserve_bps = 0` olarak
  yorumladım (yedek fon boşken yedek fon freni kredi durdurmasın). Bu havuza `--first-loss`
  yatırılmaz. Adresi `deployments/devnet.json` içinde, Kişi 2'nin stres simülasyonu için.
