# tests/ — SAHİBİ: Kişi 2 (Kişi 1 de kullanır)

Testler **LiteSVM 0.8** ile süreç içinde çalışır; doğrulayıcı (validator) gerekmez.

| Dosya | İçerik |
|---|---|
| `helpers.ts` | Ortak yardımcılar: ortam, cüzdanlar, sahte USDC, havuz, kredi fixture'ı, saat, işlem gönderme, invariant'lar |
| `lib/layout.ts` | Pool / Loan Borsh düzeni (state.rs ile birebir; IDL'de bu hesaplar yokken kullanılır) |
| `helpers.test.ts` | Yardımcıların kendi testleri |
| `invariants.test.ts` | `assertInvariants` örnekleri (olumlu ve olumsuz) |

## Çalıştırma (WSL)

```bash
npm run build   # program (SBPF v0) + IDL
npm test
# ya da
anchor test --skip-local-validator --skip-deploy --skip-build
```

Başka bir binary'yi (ör. devnet'e gidecek `.so`) test etmek için:

```bash
GLASSHOUSE_SO=/yol/glasshouse.so npm test
```

Program **SBPF v0** olarak derlenir (`--arch v0`): Solana 4.x varsayılanı v3'tür ve LiteSVM 0.8 v3'ü yükleyemez.
`anchor build -- --arch v0` IDL adımını bozduğu için program ve IDL `npm run build` içinde ayrı derlenir.

## Yeni instruction testi yazarken

```ts
const env = setupEnv();
const pool = createPool(env, HOUSE_PARAMS, { liquidity: 1_000_000n * USDC, firstLoss: 50_000n * USDC });
const loan = writeLoanFixture(env, pool, { status: LoanStatus.Late1 });

const ix = await env.program!.methods.crankLoan().accounts({ /* … */ }).instruction();
sendTx(env, [ix], [env.wallets.stranger]);

assertInvariants(env, pool, [loan.loan]); // her testin sonunda
```
