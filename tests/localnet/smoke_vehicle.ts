// P13: Araç havuzu (Diego) uçtan uca + iki havuz izolasyon testi.
//   Diego: fiyat 20.000, peşinat 8.000, anapara 12.000 → taksit 249,10, escrow 8.120, teminat 747.
//   İzolasyon: bir havuzdaki işlem diğerinin sayaçlarına ve token hesaplarına dokunmaz;
//   havuzlar arası hesap ikamesi reddedilir.
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

describe("smoke: araç havuzu (Diego) ve havuz izolasyonu", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.glasshouse as Program<Glasshouse>;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const investor = Keypair.generate();
  const diego = Keypair.generate();
  const maria = Keypair.generate();
  const seller = Keypair.generate();
  const underwriter = Keypair.generate();
  const titleAgent = Keypair.generate();
  const crank = Keypair.generate();

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const le8 = (n: number) => new BN(n).toArrayLike(Buffer, "le", 8);
  const bal = async (a: PublicKey) => (await getAccount(conn, a)).amount;
  const airdrop = async (to: PublicKey) => {
    const sig = await conn.requestAirdrop(to, 5 * LAMPORTS_PER_SOL);
    const bh = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...bh });
  };

  type Pool = ReturnType<typeof mkAccounts>;
  const mkAccounts = (id: number) => {
    const pool = pda([Buffer.from("pool"), admin.publicKey.toBuffer(), le8(id)]);
    return {
      id,
      pool,
      vault: pda([Buffer.from("vault"), pool.toBuffer()]),
      firstLossVault: pda([Buffer.from("first_loss"), pool.toBuffer()]),
      reserveVault: pda([Buffer.from("reserve"), pool.toBuffer()]),
      shareMint: pda([Buffer.from("shares"), pool.toBuffer()]),
    };
  };
  const loanOf = (c: Pool, n: number) => pda([Buffer.from("loan"), c.pool.toBuffer(), le8(n)]);
  const escrowOf = (loan: PublicKey) => pda([Buffer.from("escrow"), loan.toBuffer()]);
  const collateralOf = (loan: PublicKey) => pda([Buffer.from("collateral"), loan.toBuffer()]);

  let usdcMint: PublicKey, treasury: PublicKey;
  let adminUsdc: PublicKey, investorUsdc: PublicKey, diegoUsdc: PublicKey, mariaUsdc: PublicKey, sellerUsdc: PublicKey;

  const H = mkAccounts(921); // ev
  const V = mkAccounts(922); // araç

  const baseParams = {
    underwriter: underwriter.publicKey,
    titleAgent: titleAgent.publicKey,
    recoveryAgent: admin.publicKey,
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
  };

  const createPool = (c: Pool, over: Record<string, unknown>) =>
    program.methods
      .createPool({ ...baseParams, poolId: new BN(c.id), ...over } as any)
      .accountsPartial({
        admin: admin.publicKey,
        pool: c.pool,
        usdcMint,
        platformTreasury: treasury,
        vault: c.vault,
        firstLossVault: c.firstLossVault,
        reserveVault: c.reserveVault,
        shareMint: c.shareMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

  const seed = async (c: Pool, firstLoss: bigint, dep: bigint) => {
    await program.methods
      .fundFirstLoss(new BN(firstLoss.toString()))
      .accountsPartial({
        admin: admin.publicKey,
        pool: c.pool,
        adminTokenAccount: adminUsdc,
        firstLossVault: c.firstLossVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    const shares = await createAssociatedTokenAccount(conn, admin, c.shareMint, investor.publicKey);
    await program.methods
      .deposit(new BN(dep.toString()))
      .accountsPartial({
        depositor: investor.publicKey,
        pool: c.pool,
        depositorUsdc: investorUsdc,
        vault: c.vault,
        shareMint: c.shareMint,
        depositorShares: shares,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([investor])
      .rpc();
  };

  const apply = (c: Pool, n: number, who: Keypair, whoUsdc: PublicKey, price: bigint, down: bigint) =>
    program.methods
      .applyLoan(new BN(price.toString()), new BN(down.toString()))
      .accountsPartial({
        borrower: who.publicKey,
        seller: seller.publicKey,
        pool: c.pool,
        loan: loanOf(c, n),
        usdcMint,
        borrowerUsdc: whoUsdc,
        loanEscrow: escrowOf(loanOf(c, n)),
        collateralEscrow: collateralOf(loanOf(c, n)),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([who, seller])
      .rpc();

  const approve = (c: Pool, n: number, who: PublicKey, whoUsdc: PublicKey, appraised: bigint) =>
    program.methods
      .approveLoan({ approve: {} }, new BN(appraised.toString()), Array(32).fill(3), Array(32).fill(4), 3401, true, true)
      .accountsPartial({
        underwriter: underwriter.publicKey,
        pool: c.pool,
        loan: loanOf(c, n),
        borrower: who,
        borrowerUsdc: whoUsdc,
        loanEscrow: escrowOf(loanOf(c, n)),
        collateralEscrow: collateralOf(loanOf(c, n)),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([underwriter])
      .rpc();

  const fund = (c: Pool, n: number) =>
    program.methods
      .fundLoan()
      .accountsPartial({
        caller: crank.publicKey,
        pool: c.pool,
        loan: loanOf(c, n),
        vault: c.vault,
        loanEscrow: escrowOf(loanOf(c, n)),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([crank])
      .rpc();

  const confirm = (c: Pool, n: number) =>
    program.methods
      .confirmTitle()
      .accountsPartial({
        titleAgent: titleAgent.publicKey,
        pool: c.pool,
        loan: loanOf(c, n),
        loanEscrow: escrowOf(loanOf(c, n)),
        sellerUsdc,
        reserveVault: c.reserveVault,
        platformTreasury: treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([titleAgent])
      .rpc();

  /** Bir havuzun tüm sayaçları ve token bakiyeleri (izolasyon karşılaştırması için). */
  const snapshot = async (c: Pool) => ({
    pool: JSON.stringify(await program.account.pool.fetch(c.pool)),
    vault: (await bal(c.vault)).toString(),
    firstLoss: (await bal(c.firstLossVault)).toString(),
    reserve: (await bal(c.reserveVault)).toString(),
    supply: (await getMint(conn, c.shareMint)).supply.toString(),
  });

  /** Çağrının BELİRLİ hata koduyla reddedildiğini doğrular (yanlış sebeple geçmesin). */
  const expectFail = async (p: Promise<unknown>, what: string, code: string) => {
    try {
      await p;
    } catch (e: any) {
      const got = e?.error?.errorCode?.code ?? e?.toString();
      assert.include(String(got), code, `${what}: beklenen ${code}, gelen ${got}`);
      return;
    }
    assert.fail(`${what} reddedilmeliydi`);
  };

  before(async () => {
    for (const k of [investor, diego, maria, seller, underwriter, titleAgent, crank]) await airdrop(k.publicKey);
    usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);
    adminUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, admin.publicKey);
    investorUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, investor.publicKey);
    diegoUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, diego.publicKey);
    mariaUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, maria.publicKey);
    sellerUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, seller.publicKey);
    treasury = await createAssociatedTokenAccount(conn, admin, usdcMint, Keypair.generate().publicKey);
    await mintTo(conn, admin, usdcMint, adminUsdc, admin, 100_000n * USDC);
    await mintTo(conn, admin, usdcMint, investorUsdc, admin, 500_000n * USDC);
    await mintTo(conn, admin, usdcMint, diegoUsdc, admin, 20_000n * USDC);
    await mintTo(conn, admin, usdcMint, mariaUsdc, admin, 50_000n * USDC);

    await createPool(H, { assetType: { house: {} }, maxLtvBps: 7000, rateBps: 700, termMonths: 240, recoveryCoeffBps: 6300 });
    await createPool(V, { assetType: { vehicle: {} }, maxLtvBps: 6000, rateBps: 900, termMonths: 60, recoveryCoeffBps: 5400 });
    await seed(H, 10_000n * USDC, 100_000n * USDC);
    await seed(V, 5_000n * USDC, 50_000n * USDC);
  });

  it("araç havuzu parametreleri: %60 / %9 / 60 ay / 5400", async () => {
    const p = await program.account.pool.fetch(V.pool);
    assert.deepEqual(p.assetType, { vehicle: {} });
    assert.equal(p.maxLtvBps, 6000);
    assert.equal(p.rateBps, 900);
    assert.equal(p.termMonths, 60);
    assert.equal(p.recoveryCoeffBps, 5400);
  });

  const price = 20_000n * USDC;
  const down = 8_000n * USDC;
  const principal = price - down;

  it("araçta %60'ın altı peşinat reddedilir (7.999 < 8.000)", async () => {
    await expectFail(apply(V, 0, diego, diegoUsdc, price, down - 1n * USDC), "düşük peşinat", "InsufficientDownPayment");
  });

  it("Diego uçtan uca: taksit 249,10, escrow 8.120, teminat 747, band 20.000", async () => {
    const hBefore = await snapshot(H);
    const diegoBefore = await bal(diegoUsdc);
    const sellerBefore = await bal(sellerUsdc);
    const treasuryBefore = await bal(treasury);

    await apply(V, 0, diego, diegoUsdc, price, down);
    const inst = m.installment(principal, 900, 60);
    const l0 = await program.account.loan.fetch(loanOf(V, 0));
    assert.equal(l0.installment.toString(), inst.toString());
    assert.equal(Number(inst) / 1e6 > 249.09 && Number(inst) / 1e6 < 249.11, true, "taksit ≈ 249,10");
    assert.equal(await bal(escrowOf(loanOf(V, 0))), 8_120n * USDC);
    assert.equal((await bal(collateralOf(loanOf(V, 0)))) / USDC, 747n);

    await approve(V, 0, diego.publicKey, diegoUsdc, price);
    const l1 = await program.account.loan.fetch(loanOf(V, 0));
    assert.equal(l1.valueBand.toString(), (20_000n * USDC).toString()); // araç bandı 5k

    await fund(V, 0);
    const pv = await program.account.pool.fetch(V.pool);
    assert.equal(pv.idleCash.toString(), (38_000n * USDC).toString()); // 50k − 12k
    assert.equal(pv.totalOutstanding.toString(), principal.toString());
    assert.equal(pv.reservePending.toString(), (60n * USDC).toString()); // ücret 120 / 2
    assert.equal(await bal(escrowOf(loanOf(V, 0))), price + 120n * USDC);

    await confirm(V, 0);
    assert.equal((await bal(sellerUsdc)) - sellerBefore, price);
    assert.equal((await bal(treasury)) - treasuryBefore, 60n * USDC);
    const pv2 = await program.account.pool.fetch(V.pool);
    assert.equal(pv2.reserveBalance.toString(), (60n * USDC).toString());
    assert.equal(pv2.reservePending.toString(), "0");
    assert.equal(diegoBefore - (await bal(diegoUsdc)), 8_120n * USDC + m.collateralAmount(inst));
    const l2 = await program.account.loan.fetch(loanOf(V, 0));
    assert.deepEqual(l2.status, { active: {} });

    // İZOLASYON: araç havuzundaki tüm akış ev havuzuna hiç dokunmadı.
    assert.deepEqual(await snapshot(H), hBefore, "ev havuzu araç işleminden etkilendi");
  });

  it("izolasyon: ev havuzundaki işlem araç havuzunu etkilemez", async () => {
    const vBefore = await snapshot(V);
    await apply(H, 0, maria, mariaUsdc, 100_000n * USDC, 30_000n * USDC);
    await approve(H, 0, maria.publicKey, mariaUsdc, 100_000n * USDC);
    await fund(H, 0);
    await confirm(H, 0);
    const ph = await program.account.pool.fetch(H.pool);
    assert.equal(ph.totalOutstanding.toString(), (70_000n * USDC).toString());
    assert.deepEqual(await snapshot(V), vBefore, "araç havuzu ev işleminden etkilendi");
  });

  it("havuzlar arası hesap ikamesi reddedilir", async () => {
    // Hesap/seed doğrulaması durum kontrolünden ÖNCE çalışır; V'nin kredisi (kredi 0) yeterli.
    const hBefore = await snapshot(H);
    const vBefore = await snapshot(V);

    // fund_loan: V'nin kredisi + H'nin havuzu/vault'u
    await expectFail(
      program.methods
        .fundLoan()
        .accountsPartial({
          caller: crank.publicKey,
          pool: H.pool,
          loan: loanOf(V, 0),
          vault: H.vault,
          loanEscrow: escrowOf(loanOf(V, 0)),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([crank])
        .rpc(),
      "fund_loan çapraz havuz", "ConstraintSeeds"
    );
    // confirm_title: V'nin kredisi + H'nin Reserve'i
    await expectFail(
      program.methods
        .confirmTitle()
        .accountsPartial({
          titleAgent: titleAgent.publicKey,
          pool: H.pool,
          loan: loanOf(V, 0),
          loanEscrow: escrowOf(loanOf(V, 0)),
          sellerUsdc,
          reserveVault: H.reserveVault,
          platformTreasury: treasury,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([titleAgent])
        .rpc(),
      "confirm_title çapraz havuz", "ConstraintSeeds"
    );
    // deposit: H havuzu + V'nin pay mint'i
    const vShares = await createAssociatedTokenAccount(conn, admin, V.shareMint, maria.publicKey);
    await expectFail(
      program.methods
        .deposit(new BN((1n * USDC).toString()))
        .accountsPartial({
          depositor: investor.publicKey,
          pool: H.pool,
          depositorUsdc: investorUsdc,
          vault: H.vault,
          shareMint: V.shareMint,
          depositorShares: vShares,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([investor])
        .rpc(),
      "deposit çapraz mint", "ConstraintSeeds"
    );

    assert.deepEqual(await snapshot(H), hBefore);
    assert.deepEqual(await snapshot(V), vBefore);
  });
});
