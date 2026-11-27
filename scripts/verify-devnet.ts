// Devnet doğrulama — SAHİBİ: Kişi 2. Seed'den (scripts/seed.ts) sonra çalıştırılır.
//
// A) OKUMA (zincire yazmaz): program hash'i, havuz parametreleri ve invariant'lar, kredi durumları.
// B) SİMÜLASYON (simulateTransaction; zincire YAZMAZ): yetki ve durum makinesi kontrolleri
//    (yabancı record_recovery, Defaulted krediye crank/repay, ...) ve record_recovery'nin zarar sırası
//    sonucu (gerçek kredi durumuna dokunmadan).
// C) --execute (küçük zincir yazmaları; onay gerektirir): bir Active krediye 1 taksit `repay` ve
//    yatırım → çekim talebi → process_withdrawals turu; sonuçlar NAV formülüyle doğrulanır.
//
// Çıkış kodu 1: en az bir ✗ var. ⚠ uyarıdır (örn. yerel .so ile zincirdeki program farklı).
//
//   export ANCHOR_PROVIDER_URL=<RPC>  ANCHOR_WALLET=<deployer.json>
//   npx ts-node -P scripts/tsconfig.json scripts/verify-devnet.ts              # A + B (yazmaz)
//   npx ts-node -P scripts/tsconfig.json scripts/verify-devnet.ts --execute    # + C
//
// Gerekenler: scripts/out/seed-addresses.json ve .keys/ (seed'i çalıştıran makine).

import { BN } from "@coral-xyz/anchor";
import { getAccount, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotent, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { EXECUTE, getProgram, getProvider, ROOT, requireKeypair, USDC } from "./lib";

const SEED_FILE = path.join(ROOT, "scripts", "out", "seed-addresses.json");
const LOCAL_SO = path.join(ROOT, "target", "deploy", "glasshouse.so");
const KNOWN_SO: Record<string, string> = {
  fce6cadfcee51e66ebab5b12a66b16da14dd6935ef28314d5a79596abfafe24a: "eski (faiz düzeltmesi YOK)",
  "2172fb2910b78fd2b6a8e8eb63cf57614c98c7bf99b567b0050d2d1284eb5571": "yeni (faiz düzeltmesi var)",
};

// ───────────────────────────── Sonuç toplama ─────────────────────────────

let fails = 0;
let warns = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => {
  fails++;
  console.log(`  ✗ ${msg}`);
};
const warn = (msg: string) => {
  warns++;
  console.log(`  ⚠ ${msg}`);
};
const check = (cond: boolean, pass: string, fail: string) => (cond ? ok(pass) : bad(fail));
const section = (t: string) => console.log(`\n== ${t}`);

const big = (b: any): bigint => BigInt(b.toString());
const statusName = (s: any): string => Object.keys(s)[0];
const usd = (v: bigint): string => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
const u64le = (v: number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};

// ───────────────────────────── Ana akış ─────────────────────────────

async function main() {
  if (!fs.existsSync(SEED_FILE)) throw new Error(`${SEED_FILE} yok. Önce scripts/seed.ts --execute çalıştırın.`);
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"));
  const provider = getProvider();
  const conn = provider.connection;
  const payer: Keypair = (provider.wallet as any).payer;
  const program: any = getProgram(provider);
  const programId: PublicKey = program.programId;
  const usdcMint = new PublicKey(seed.usdcMint);
  const key = (role: string) => requireKeypair(role);
  const wallet = (role: string) => new PublicKey(seed.wallets[role].publicKey);
  const ata = (role: string) => getAssociatedTokenAddressSync(usdcMint, wallet(role), true);
  const tokenBal = async (a: PublicKey): Promise<bigint> => (await getAccount(conn, a)).amount;

  // ---------- A1) program ----------
  section("A1) Program");
  const progAcc = await conn.getAccountInfo(programId);
  check(!!progAcc?.executable, `program yürütülebilir: ${programId.toBase58()}`, "program hesabı yok ya da yürütülebilir değil");
  if (progAcc && fs.existsSync(LOCAL_SO)) {
    const local = fs.readFileSync(LOCAL_SO);
    let chain: Buffer | null = null;
    if (progAcc.owner.toBase58() === "BPFLoaderUpgradeab1e11111111111111111111111") {
      // Upgradeable: program hesabı → programdata (başlık 45 bayt, sonra ELF).
      const pdAcc = await conn.getAccountInfo(new PublicKey(progAcc.data.subarray(4, 36)));
      chain = pdAcc ? Buffer.from(pdAcc.data.subarray(45, 45 + local.length)) : null;
    } else {
      chain = Buffer.from(progAcc.data.subarray(0, local.length)); // yerel doğrulayıcı (--bpf-program)
    }
    if (chain) {
      const hChain = crypto.createHash("sha256").update(chain).digest("hex");
      const hLocal = crypto.createHash("sha256").update(local).digest("hex");
      const label = KNOWN_SO[hChain] ? ` — ${KNOWN_SO[hChain]}` : "";
      console.log(`  zincirdeki program sha256: ${hChain}${label}`);
      if (hChain === hLocal) ok("yerel target/deploy/glasshouse.so ile aynı");
      else warn(`yerel .so (${hLocal.slice(0, 12)}…) zincirdekinden farklı; faiz düzeltmeli sürüm (2172fb29…) deploy edildi mi?`);
    } else warn("programdata okunamadı; hash karşılaştırılamadı");
  } else {
    warn("program hash'i karşılaştırılamadı (yerel target/deploy/glasshouse.so yok)");
  }

  // ---------- A2) havuzlar ----------
  section("A2) Havuzlar ve invariant'lar");
  const pools: Record<string, any> = {};
  for (const name of ["house", "vehicle"]) {
    const p = seed.pools[name];
    const addr = new PublicKey(p.address);
    const st = await program.account.pool.fetch(addr);
    pools[name] = { ...p, addr, st };
    const vault = await tokenBal(new PublicKey(p.vault));
    const fl = await tokenBal(new PublicKey(p.firstLossVault));
    const rs = await tokenBal(new PublicKey(p.reserve));
    const supply = (await conn.getTokenSupply(new PublicKey(p.shareMint))).value.amount;
    console.log(`  [${name}] idle ${usd(big(st.idleCash))}, outstanding ${usd(big(st.totalOutstanding))}, ilk zarar ${usd(big(st.firstLossBalance))}, yedek ${usd(big(st.reserveBalance))}`);
    check(st.maxLtvBps === p.maxLtvBps && st.rateBps === p.rateBps && st.termMonths === p.termMonths, `${name}: LTV/faiz/vade JSON ile aynı`, `${name}: parametreler JSON'dan farklı`);
    check(st.periodSeconds.toString() === String(p.periodSeconds) && st.graceSeconds.toString() === String(p.graceSeconds), `${name}: period/grace = ${p.periodSeconds}/${p.graceSeconds} sn`, `${name}: period/grace farklı`);
    check(vault >= big(st.idleCash), `${name}: vault (${usd(vault)}) ≥ idle_cash`, `${name}: vault < idle_cash !!`);
    check(fl >= big(st.firstLossBalance), `${name}: ilk zarar kasası token ≥ sayaç`, `${name}: ilk zarar token < sayaç`);
    check(rs >= big(st.reserveBalance), `${name}: yedek fon token ≥ sayaç`, `${name}: yedek fon token < sayaç`);
    check(BigInt(supply) <= big(st.totalShares), `${name}: pay arzı ≤ total_shares`, `${name}: pay arzı > total_shares !!`);
    const gross = big(st.idleCash) + big(st.totalOutstanding);
    const shortfall = big(st.lossProvision) - big(st.firstLossBalance) - big(st.reserveBalance);
    const nav = shortfall > 0n ? gross - shortfall : gross;
    pools[name].nav = nav;
    console.log(`  [${name}] senior NAV ${usd(nav)}, toplam pay ${usd(big(st.totalShares))}, pay fiyatı ${(Number(nav + 1_000_000n) / Number(big(st.totalShares) + 1_000_000n)).toFixed(6)}`);
  }

  // ---------- A3) krediler ----------
  section("A3) Krediler");
  const loans: any[] = [];
  const sumOutstanding: Record<string, bigint> = { house: 0n, vehicle: 0n };
  for (const l of seed.loans) {
    const addr = new PublicKey(l.address);
    const d = await program.account.loan.fetch(addr);
    const status = statusName(d.status);
    loans.push({ ...l, addr, d, status });
    if (["active", "late1", "late2", "defaulted"].includes(status)) sumOutstanding[l.pool] += big(d.remainingPrincipal);
    if (status !== l.status) warn(`${l.pool} #${l.loanId}: durum seed'den beri değişti (${l.status} → ${status})`);
    if (["active", "late1", "late2"].includes(status)) {
      const col = await tokenBal(new PublicKey(l.collateralEscrow));
      const deducted = Buffer.from(d.reserved).readBigUInt64LE(0);
      const expected = 3n * big(d.installment) - deducted;
      if (col < expected) bad(`${l.pool} #${l.loanId}: teminat (${usd(col)}) beklenenden (${usd(expected)}) az`);
    }
  }
  const counts: Record<string, number> = {};
  for (const l of loans) counts[`${l.pool}:${l.status}`] = (counts[`${l.pool}:${l.status}`] ?? 0) + 1;
  console.log("  " + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  "));
  for (const name of ["house", "vehicle"]) {
    const inSeed = loans.filter((l) => l.pool === name).length;
    if (Number(pools[name].st.nextLoanId) === inSeed) {
      check(big(pools[name].st.totalOutstanding) === sumOutstanding[name], `${name}: total_outstanding = servis edilen kredilerin kalan anapara toplamı (${usd(sumOutstanding[name])})`, `${name}: total_outstanding (${usd(big(pools[name].st.totalOutstanding))}) ≠ kredi toplamı (${usd(sumOutstanding[name])})`);
    } else {
      warn(`${name}: havuzda seed dışı krediler var (next_loan_id ${pools[name].st.nextLoanId}), toplam karşılaştırması atlandı`);
    }
  }

  // ---------- B) simülasyonlar ----------
  section("B) Simülasyon (zincire yazmaz): yetki ve durum makinesi");
  const loanPdas = (pool: PublicKey, id: number) => {
    const [loan] = PublicKey.findProgramAddressSync([Buffer.from("loan"), pool.toBuffer(), u64le(id)], programId);
    const [escrow] = PublicKey.findProgramAddressSync([Buffer.from("escrow"), loan.toBuffer()], programId);
    const [collateral] = PublicKey.findProgramAddressSync([Buffer.from("collateral"), loan.toBuffer()], programId);
    return { loan, escrow, collateral };
  };
  const simulate = async (label: string, tx: Transaction, signers: Keypair[], expect: number | "ok") => {
    const res = await conn.simulateTransaction(tx, [payer, ...signers]);
    const logs: string[] = res.value.logs ?? [];
    if (expect === "ok") {
      check(res.value.err === null, `${label}: başarılı olurdu`, `${label}: başarısız olurdu — ${JSON.stringify(res.value.err)} ${logs.slice(-3).join(" | ")}`);
    } else {
      const hit = logs.some((l) => l.includes(`Error Number: ${expect}.`));
      check(res.value.err !== null && hit, `${label}: ${expect} ile reddedilir`, `${label}: ${expect} bekleniyordu — ${res.value.err ? logs.slice(-2).join(" | ") : "BAŞARILI oldu"}`);
    }
    return logs;
  };
  const byStatus = (pool: string, s: string) => loans.find((l) => l.pool === pool && l.status === s);

  const crankTx = async (l: any, who: Keypair) => {
    const P = pools[l.pool];
    const { collateral } = loanPdas(P.addr, l.loanId);
    return program.methods
      .crankLoan()
      .accountsPartial({
        cranker: who.publicKey,
        pool: P.addr,
        loan: l.addr,
        collateral,
        vault: new PublicKey(P.vault),
        reserve: new PublicKey(P.reserve),
        platformTreasury: new PublicKey(P.platformTreasury),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
  };
  const recoveryTx = async (l: any, who: Keypair, proceeds: bigint) => {
    const P = pools[l.pool];
    const { collateral } = loanPdas(P.addr, l.loanId);
    return program.methods
      .recordRecovery(new BN(proceeds.toString()))
      .accountsPartial({
        recoveryAgent: who.publicKey,
        coSigner: null,
        pool: P.addr,
        loan: l.addr,
        recoverySource: getAssociatedTokenAddressSync(usdcMint, who.publicKey, true),
        vault: new PublicKey(P.vault),
        collateral,
        firstLoss: new PublicKey(P.firstLossVault),
        reserve: new PublicKey(P.reserve),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
  };

  const stranger = key("crank");
  const agent = key("recoveryAgent");
  const def = byStatus("house", "defaulted");
  const late1 = byStatus("house", "late1");
  const active = byStatus("house", "active");
  const vehicleActive = byStatus("vehicle", "active");

  if (def) {
    await simulate("crank, Defaulted kredi", await crankTx(def, stranger), [stranger], 6015); // LoanNotServiceable
    await simulate("record_recovery, yabancı cüzdan", await recoveryTx(def, stranger, 1_000n * USDC), [stranger], 6000); // Unauthorized
    // Zarar sırası: değer × 0,63 (%30 düşüş, %10 masraf). Gerçek durum değişmez.
    const value = big(def.d.price) < big(def.d.appraisedValue) ? big(def.d.price) : big(def.d.appraisedValue);
    const proceeds = (value * 63n) / 100n;
    const logs = await simulate(`record_recovery, recovery_agent (gelir ${usd(proceeds)})`, await recoveryTx(def, agent, proceeds), [agent], "ok");
    const ev = readRecovery(logs, program);
    if (ev) {
      console.log(`    zarar sırası: zarar ${usd(ev.loss)} → teminat ${usd(ev.collateralUsed)}, ilk zarar kasası ${usd(ev.firstLossUsed)}, yedek ${usd(ev.reserveUsed)}, senior ${usd(ev.seniorLoss)}`);
      check(ev.firstLossUsed + ev.reserveUsed + ev.seniorLoss === ev.loss, "zarar = kasa + yedek + senior", "zarar dağılımı toplamı tutmuyor");
    }
  } else warn("Defaulted ev kredisi yok: crank/recovery simülasyonları atlandı");
  if (late1) {
    // Süreye bağlı: aynı dönemdeyse PeriodAlreadyProcessed, bir sonraki dönem gelmişse Late2 adımı işlenirdi.
    const res = await conn.simulateTransaction(await crankTx(late1, stranger), [payer, stranger]);
    const logs: string[] = res.value.logs ?? [];
    if (res.value.err === null) ok("crank, Late1 kredi: sonraki dönem geldi, bir sonraki adım (Late2) işlenirdi");
    else check(logs.some((l) => l.includes("Error Number: 6016.")), "crank, Late1 kredi: aynı dönem tekrar işlenmez (PeriodAlreadyProcessed 6016)", `crank, Late1: beklenmeyen hata — ${logs.slice(-2).join(" | ")}`);
  }
  if (active) {
    await simulate("record_recovery, Active kredi", await recoveryTx(active, agent, 1_000n * USDC), [agent], 6015);
    const P = pools.house;
    const { collateral } = loanPdas(P.addr, active.loanId);
    const payoffByStranger = await program.methods
      .payoff()
      .accountsPartial({
        borrower: stranger.publicKey,
        pool: P.addr,
        loan: active.addr,
        borrowerUsdc: getAssociatedTokenAddressSync(usdcMint, stranger.publicKey, true),
        vault: new PublicKey(P.vault),
        reserve: new PublicKey(P.reserve),
        platformTreasury: new PublicKey(P.platformTreasury),
        collateral,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    await simulate("payoff, borçlu olmayan cüzdan", payoffByStranger, [stranger], 6000);
  }
  if (def) {
    const P = pools[def.pool];
    const repayDefaulted = await program.methods
      .repay(new BN((100n * USDC).toString()))
      .accountsPartial({
        payer: stranger.publicKey,
        pool: P.addr,
        loan: def.addr,
        payerUsdc: getAssociatedTokenAddressSync(usdcMint, stranger.publicKey, true),
        vault: new PublicKey(P.vault),
        reserve: new PublicKey(P.reserve),
        platformTreasury: new PublicKey(P.platformTreasury),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    await simulate("repay, Defaulted kredi", repayDefaulted, [stranger], 6015);
  }
  {
    const P = pools.house;
    const flByStranger = await program.methods
      .fundFirstLoss(new BN(USDC.toString()))
      .accountsPartial({
        admin: stranger.publicKey,
        pool: P.addr,
        adminTokenAccount: getAssociatedTokenAddressSync(usdcMint, stranger.publicKey, true),
        firstLossVault: new PublicKey(P.firstLossVault),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    await simulate("fund_first_loss, yabancı cüzdan", flByStranger, [stranger], 6000);
  }
  if (vehicleActive) ok(`araç havuzunda ${vehicleActive.status} kredi var (#${vehicleActive.loanId})`);
  else warn("araç havuzunda Active kredi yok");

  // ---------- C) zincire yazan tur ----------
  if (!EXECUTE) {
    console.log("\n(C) atlandı: zincire yazan tur için --execute ekleyin.");
  } else {
    section("C) Zincire yazan tur (--execute)");
    if (active) await repayRound(active);
    await withdrawRound();
  }

  async function repayRound(l: any) {
    const P = pools[l.pool];
    const borrowerRole = l.pool === "house" ? "borrowerMaria" : "borrowerDiego";
    const borrower = key(borrowerRole);
    const d0 = await program.account.loan.fetch(l.addr);
    const installment = big(d0.installment);
    const remaining0 = big(d0.remainingPrincipal);
    const rate = Number(d0.rateBps);
    const before = {
      vault: await tokenBal(new PublicKey(P.vault)),
      reserve: await tokenBal(new PublicKey(P.reserve)),
      treasury: await tokenBal(new PublicKey(P.platformTreasury)),
      idle: big((await program.account.pool.fetch(P.addr)).idleCash),
    };
    const { collateral } = loanPdas(P.addr, l.loanId);
    void collateral;
    await program.methods
      .repay(new BN(installment.toString()))
      .accountsPartial({
        payer: borrower.publicKey,
        pool: P.addr,
        loan: l.addr,
        payerUsdc: ata(borrowerRole),
        vault: new PublicKey(P.vault),
        reserve: new PublicKey(P.reserve),
        platformTreasury: new PublicKey(P.platformTreasury),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([borrower])
      .rpc();
    const d1 = await program.account.loan.fetch(l.addr);
    const after = {
      vault: await tokenBal(new PublicKey(P.vault)),
      reserve: await tokenBal(new PublicKey(P.reserve)),
      treasury: await tokenBal(new PublicKey(P.platformTreasury)),
      idle: big((await program.account.pool.fetch(P.addr)).idleCash),
    };
    // Faiz = kalan × oran / 12, yukarı yuvarlanır (±1 micro-USDC); platform ve yedek payı faiz × 50 / oran (aşağı).
    const interest = (remaining0 * BigInt(rate) + 119_999n) / 120_000n;
    const share = (interest * 50n) / BigInt(rate);
    const near = (a: bigint, b: bigint) => (a > b ? a - b : b - a) <= 2n;
    check(big(d1.remainingPrincipal) === remaining0 - (installment - interest) || near(big(d1.remainingPrincipal), remaining0 - (installment - interest)), `repay ${l.pool} #${l.loanId}: kalan anapara taksit − faiz kadar azaldı`, `repay: kalan anapara beklenenden farklı (${big(d1.remainingPrincipal)} vs ${remaining0 - (installment - interest)})`);
    check(near(after.treasury - before.treasury, share), `platform payı ≈ faiz × 50 / oran (${usd(after.treasury - before.treasury)})`, `platform payı beklenenden farklı: ${after.treasury - before.treasury} vs ${share}`);
    check(near(after.reserve - before.reserve, share), `yedek fon payı ≈ faiz × 50 / oran (${usd(after.reserve - before.reserve)})`, `yedek payı beklenenden farklı: ${after.reserve - before.reserve} vs ${share}`);
    check(after.vault - before.vault === after.idle - before.idle, "vault artışı = idle_cash artışı (havuz payı + anapara)", "vault artışı idle_cash artışına eşit değil");
    check(Number(d1.paidInstallments) === Number(d0.paidInstallments) + 1, "ödenen taksit sayısı +1", "paid_installments artmadı");
  }

  async function withdrawRound() {
    const P = pools.house;
    const inv = key("investorB");
    const invUsdc = ata("investorB");
    const sharesAta = await createAssociatedTokenAccountIdempotent(conn, payer, new PublicKey(P.shareMint), inv.publicKey);
    const amount = 100n * USDC;
    const st0 = await program.account.pool.fetch(P.addr);
    if (big(st0.withdrawHead) !== big(st0.withdrawTail)) {
      warn("çekim kuyruğunda bekleyen talep var; çekim turu atlandı");
      return;
    }
    const fee = (amount * BigInt(st0.entryExitFeeBps) + 9_999n) / 10_000n;
    const navOf = (s: any) => {
      const gross = big(s.idleCash) + big(s.totalOutstanding);
      const short = big(s.lossProvision) - big(s.firstLossBalance) - big(s.reserveBalance);
      return short > 0n ? gross - short : gross;
    };
    const expectedShares = ((amount - fee) * (big(st0.totalShares) + 1_000_000n)) / (navOf(st0) + 1_000_000n);
    const held0 = (await getAccount(conn, sharesAta)).amount;
    await program.methods
      .deposit(new BN(amount.toString()))
      .accountsPartial({
        depositor: inv.publicKey,
        pool: P.addr,
        depositorUsdc: invUsdc,
        vault: new PublicKey(P.vault),
        shareMint: new PublicKey(P.shareMint),
        depositorShares: sharesAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([inv])
      .rpc();
    const minted = (await getAccount(conn, sharesAta)).amount - held0;
    check(minted === expectedShares, `deposit ${usd(amount)} USDC → ${usd(minted)} pay (NAV formülüyle birebir)`, `deposit: basılan pay ${minted}, beklenen ${expectedShares}`);

    // Çekim talebi → işlem
    const st1 = await program.account.pool.fetch(P.addr);
    const seq = big(st1.withdrawTail);
    const [wreq] = PublicKey.findProgramAddressSync([Buffer.from("wreq"), P.addr.toBuffer(), u64le(Number(seq))], programId);
    const [shareEscrow] = PublicKey.findProgramAddressSync([Buffer.from("share_escrow"), P.addr.toBuffer()], programId);
    await program.methods
      .requestWithdraw(new BN(minted.toString()))
      .accountsPartial({
        owner: inv.publicKey,
        pool: P.addr,
        shareMint: new PublicKey(P.shareMint),
        ownerShares: sharesAta,
        destination: invUsdc,
        shareEscrow,
        withdrawRequest: wreq,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([inv])
      .rpc();
    const st2 = await program.account.pool.fetch(P.addr);
    const nav2 = navOf(st2);
    const grossOut = (minted * (nav2 + 1_000_000n)) / (big(st2.totalShares) + 1_000_000n);
    const feeOut = (grossOut * BigInt(st2.entryExitFeeBps) + 9_999n) / 10_000n;
    const netOut = grossOut - feeOut;
    const balBefore = await tokenBal(invUsdc);
    await program.methods
      .processWithdrawals()
      .accountsPartial({
        cranker: stranger.publicKey,
        pool: P.addr,
        vault: new PublicKey(P.vault),
        shareMint: new PublicKey(P.shareMint),
        shareEscrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: wreq, isSigner: false, isWritable: true },
        { pubkey: invUsdc, isSigner: false, isWritable: true },
        { pubkey: inv.publicKey, isSigner: false, isWritable: true },
      ])
      .signers([stranger])
      .rpc();
    const paid = (await tokenBal(invUsdc)) - balBefore;
    check(paid === netOut, `çekim: ${usd(minted)} pay → ${usd(paid)} USDC (işlem anındaki NAV, giriş+çıkış ücreti ≈ ${usd(fee + feeOut)})`, `çekim: ödenen ${paid}, beklenen ${netOut}`);
    const st3 = await program.account.pool.fetch(P.addr);
    check(big(st3.withdrawHead) === seq + 1n, "kuyruk başı ilerledi, talep kapandı", "withdraw_head ilerlemedi");
    check((await conn.getAccountInfo(wreq)) === null, "talep hesabı kapandı", "talep hesabı hâlâ açık");
  }

  // ---------- özet ----------
  console.log(`\nÖZET: ${fails === 0 ? "✓ hepsi geçti" : `✗ ${fails} hata`}${warns ? `, ⚠ ${warns} uyarı` : ""}`);
  if (fails) process.exit(1);
}

/** record_recovery simülasyon loglarından RecoveryRecorded alanlarını ham baytlardan okur (BN çok sözcük sorunu). */
function readRecovery(logs: string[], program: any) {
  const def = (program.idl.events ?? []).find((e: any) => e.name.toLowerCase() === "recoveryrecorded");
  if (!def) return null;
  const disc = Buffer.from(def.discriminator);
  for (const l of logs) {
    if (!l.startsWith("Program data: ")) continue;
    const b = Buffer.from(l.slice("Program data: ".length), "base64");
    if (!b.subarray(0, 8).equals(disc) || b.length < 8 + 64 + 56) continue;
    let o = 8 + 64; // pool, loan
    const u = () => {
      const v = b.readBigUInt64LE(o);
      o += 8;
      return v;
    };
    u(); // loan_id
    u(); // proceeds
    const collateralUsed = u();
    const loss = u();
    const firstLossUsed = u();
    const reserveUsed = u();
    const seniorLoss = u();
    return { collateralUsed, loss, firstLossUsed, reserveUsed, seniorLoss };
  }
  return null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
