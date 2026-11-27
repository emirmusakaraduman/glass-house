// P11: Ev akışı smoke testi (Maria örneği). Kapsamlı testlerin yerine geçmez; yalnızca
// create_pool → fund_first_loss → deposit → apply_loan → approve_loan → fund_loan →
// confirm_title akışının uçtan uca çalıştığını kanıtlar. Her adımdan sonra NAV, pay fiyatı
// ve invariant'lar yazdırılır ve doğrulanır.
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getMint,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import type { Glasshouse } from "../../target/types/glasshouse";
import * as m from "../helpers/loanMath";

const USDC = 1_000_000n;
const fmt = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2 });

describe("smoke: ev akışı uçtan uca (Maria)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.glasshouse as Program<Glasshouse>;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const investor = Keypair.generate();
  const maria = Keypair.generate(); // borçlu
  const seller = Keypair.generate();
  const underwriter = Keypair.generate();
  const titleAgent = Keypair.generate();
  const recoveryAgent = Keypair.generate();
  const crank = Keypair.generate(); // yabancı çağıran

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const airdrop = async (to: PublicKey) => {
    const sig = await conn.requestAirdrop(to, 5 * LAMPORTS_PER_SOL);
    const bh = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...bh });
  };
  const bal = async (a: PublicKey) => (await getAccount(conn, a)).amount;

  const poolId = new BN(900);
  const pool = pda([Buffer.from("pool"), admin.publicKey.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)]);
  const vault = pda([Buffer.from("vault"), pool.toBuffer()]);
  const firstLossVault = pda([Buffer.from("first_loss"), pool.toBuffer()]);
  const reserveVault = pda([Buffer.from("reserve"), pool.toBuffer()]);
  const shareMint = pda([Buffer.from("shares"), pool.toBuffer()]);
  const loan = pda([Buffer.from("loan"), pool.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8)]);
  const escrow = pda([Buffer.from("escrow"), loan.toBuffer()]);
  const collateral = pda([Buffer.from("collateral"), loan.toBuffer()]);

  let usdcMint: PublicKey;
  let adminUsdc: PublicKey, investorUsdc: PublicKey, mariaUsdc: PublicKey, sellerUsdc: PublicKey;
  let treasury: PublicKey, investorShares: PublicKey;

  const price = 100_000n * USDC;
  const down = 30_000n * USDC;
  const principal = price - down;
  const installment = m.installment(principal, 700, 240);
  const collateralAmt = m.collateralAmount(installment);
  const fee = m.originationFee(principal);

  /** Adım sonrası durum: NAV, pay fiyatı ve tüm invariant'lar. */
  const snapshot = async (step: string, loanStatus?: string) => {
    const p = await program.account.pool.fetch(pool);
    const idle = BigInt(p.idleCash.toString());
    const outstanding = BigInt(p.totalOutstanding.toString());
    const shares = BigInt(p.totalShares.toString());
    const nav = m.seniorNav({
      idleCash: idle,
      totalOutstanding: outstanding,
      lossProvision: BigInt(p.lossProvision.toString()),
      firstLossBalance: BigInt(p.firstLossBalance.toString()),
      reserveBalance: BigInt(p.reserveBalance.toString()),
    });
    const sp = m.sharePrice(nav, shares);
    const vaultAmt = await bal(vault);
    const supply = (await getMint(conn, shareMint)).supply;
    const flVault = await bal(firstLossVault);
    const resVault = await bal(reserveVault);

    console.log(
      `    [${step}] NAV=${fmt(nav)} pay_fiyatı=${(Number(sp) / 1e18).toFixed(9)} ` +
        `idle=${fmt(idle)} outstanding=${fmt(outstanding)} reserve=${fmt(BigInt(p.reserveBalance.toString()))} ` +
        `reserve_pending=${fmt(BigInt(p.reservePending.toString()))}` +
        (loanStatus ? ` kredi=${loanStatus}` : "")
    );

    // invariant'lar
    assert.isTrue(vaultAmt >= idle, `${step}: vault ≥ idle_cash`);
    assert.isTrue(supply <= shares, `${step}: pay arzı ≤ total_shares`);
    assert.isTrue(flVault >= BigInt(p.firstLossBalance.toString()), `${step}: ilk zarar kasası ≥ sayaç`);
    assert.isTrue(resVault >= BigInt(p.reserveBalance.toString()), `${step}: Reserve ≥ sayaç`);
    return { nav, sp, idle, outstanding, p };
  };

  before(async () => {
    for (const k of [investor, maria, seller, underwriter, titleAgent, crank]) await airdrop(k.publicKey);
    usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);
    adminUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, admin.publicKey);
    investorUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, investor.publicKey);
    mariaUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, maria.publicKey);
    sellerUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, seller.publicKey);
    treasury = await createAssociatedTokenAccount(conn, admin, usdcMint, Keypair.generate().publicKey);
    await mintTo(conn, admin, usdcMint, adminUsdc, admin, 10_000n * USDC);
    await mintTo(conn, admin, usdcMint, investorUsdc, admin, 200_000n * USDC);
    await mintTo(conn, admin, usdcMint, mariaUsdc, admin, 40_000n * USDC);
  });

  it("create → first_loss → deposit → apply → approve → fund → confirm", async () => {
    console.log("");

    // 1) create_pool (ev ürün değerleri)
    await program.methods
      .createPool({
        poolId,
        assetType: { house: {} },
        underwriter: underwriter.publicKey,
        titleAgent: titleAgent.publicKey,
        recoveryAgent: recoveryAgent.publicKey,
        maxLtvBps: 7000,
        rateBps: 700,
        termMonths: 240,
        recoveryCoeffBps: 6300,
        graceSeconds: new BN(10),
        periodSeconds: new BN(60),
        provisionBps: [0, 500, 1500, 1500],
        bufferBps: 1000,
        brakeLateBps: 1000,
        brakeReserveBps: 25,
        minFirstLossBps: 500,
        entryExitFeeBps: 20,
        minRecoveryBps: 0,
        titleTimeoutSeconds: new BN(3600),
      })
      .accountsPartial({
        admin: admin.publicKey,
        pool,
        usdcMint,
        platformTreasury: treasury,
        vault,
        firstLossVault,
        reserveVault,
        shareMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    investorShares = await createAssociatedTokenAccount(conn, admin, shareMint, investor.publicKey);
    const s1 = await snapshot("1 create_pool");
    assert.equal(s1.nav, 0n);

    // 2) fund_first_loss (≥ %5 × 70k = 3.500)
    await program.methods
      .fundFirstLoss(new BN((5_000n * USDC).toString()))
      .accountsPartial({
        admin: admin.publicKey,
        pool,
        adminTokenAccount: adminUsdc,
        firstLossVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    const s2 = await snapshot("2 fund_first_loss");
    assert.equal(s2.p.firstLossBalance.toString(), (5_000n * USDC).toString());

    // 3) deposit (yatırımcı 100k)
    await program.methods
      .deposit(new BN((100_000n * USDC).toString()))
      .accountsPartial({
        depositor: investor.publicKey,
        pool,
        depositorUsdc: investorUsdc,
        vault,
        shareMint,
        depositorShares: investorShares,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([investor])
      .rpc();
    const s3 = await snapshot("3 deposit");
    assert.equal(s3.idle, 100_000n * USDC);
    const navBeforeLoan = s3.nav;

    // 4) apply_loan (borçlu + satıcı imzalar)
    const mariaBefore = await bal(mariaUsdc);
    await program.methods
      .applyLoan(new BN(price.toString()), new BN(down.toString()))
      .accountsPartial({
        borrower: maria.publicKey,
        seller: seller.publicKey,
        pool,
        loan,
        usdcMint,
        borrowerUsdc: mariaUsdc,
        loanEscrow: escrow,
        collateralEscrow: collateral,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maria, seller])
      .rpc();
    const s4 = await snapshot("4 apply_loan", "Pending");
    assert.equal(s4.nav, navBeforeLoan, "apply_loan NAV'ı değiştirmemeli");
    assert.equal(await bal(escrow), 30_700n * USDC);
    assert.equal(await bal(collateral), collateralAmt);
    assert.equal(collateralAmt / USDC, 1_628n);

    // 5) approve_loan
    await program.methods
      .approveLoan({ approve: {} }, new BN(price.toString()), Array(32).fill(1), Array(32).fill(2), 4034, true, true)
      .accountsPartial({
        underwriter: underwriter.publicKey,
        pool,
        loan,
        borrower: maria.publicKey,
        borrowerUsdc: mariaUsdc,
        loanEscrow: escrow,
        collateralEscrow: collateral,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([underwriter])
      .rpc();
    const s5 = await snapshot("5 approve_loan", "Approved");
    assert.equal(s5.nav, navBeforeLoan);

    // 6) fund_loan (yabancı çağıran: permissionless)
    await program.methods
      .fundLoan()
      .accountsPartial({
        caller: crank.publicKey,
        pool,
        loan,
        vault,
        loanEscrow: escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([crank])
      .rpc();
    const s6 = await snapshot("6 fund_loan", "Funded");
    assert.equal(s6.nav, navBeforeLoan, "fund_loan NAV'ı değiştirmemeli (idle → outstanding)");
    assert.equal(s6.idle, 30_000n * USDC, "idle = 100k − 70k");
    assert.equal(s6.outstanding, principal);
    assert.equal(s6.p.reservePending.toString(), (fee / 2n).toString());
    assert.equal(await bal(escrow), price + fee);

    // 7) confirm_title
    const sellerBefore = await bal(sellerUsdc);
    const treasuryBefore = await bal(treasury);
    await program.methods
      .confirmTitle()
      .accountsPartial({
        titleAgent: titleAgent.publicKey,
        pool,
        loan,
        loanEscrow: escrow,
        sellerUsdc,
        reserveVault,
        platformTreasury: treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([titleAgent])
      .rpc();
    const s7 = await snapshot("7 confirm_title", "Active");
    assert.equal(s7.nav, navBeforeLoan, "tüm akış boyunca NAV sabit (zarar yok)");
    assert.equal((await bal(sellerUsdc)) - sellerBefore, price);
    assert.equal((await bal(treasury)) - treasuryBefore, fee - fee / 2n);
    assert.equal(s7.p.reserveBalance.toString(), (fee / 2n).toString());
    assert.equal(s7.p.reservePending.toString(), "0");
    assert.equal(await bal(escrow), 0n);

    // son durum: Maria toplam peşinat + ücret + teminat ödedi
    assert.equal(mariaBefore - (await bal(mariaUsdc)), 30_700n * USDC + collateralAmt);
    const l = await program.account.loan.fetch(loan);
    assert.deepEqual(l.status, { active: {} });
    assert.equal(l.installment.toString(), installment.toString());
    assert.equal(l.principal.toString(), principal.toString());
    console.log(
      `    taksit=${fmt(installment)} teminat=${fmt(collateralAmt)} ücret=${fmt(fee)} ` +
        `(Maria referansı: 542,71 / 1.628,13 / 700,00)\n`
    );
  });
});
