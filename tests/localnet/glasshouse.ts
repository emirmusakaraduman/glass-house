// Backend A testleri: create_pool, fund_first_loss, deposit.
// (apply_loan ... confirm_title yazıldıkça aynı dosya/dizine eklenir.)
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  burn,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  getMint,
  mintTo,
  transfer,
} from "@solana/spl-token";
import { assert } from "chai";
import type { Glasshouse } from "../../target/types/glasshouse";
import * as m from "../helpers/loanMath";

const USDC = 1_000_000n;

describe("glasshouse: pool kurulumu ve yatırım", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.glasshouse as Program<Glasshouse>;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const investorA = Keypair.generate();
  const investorB = Keypair.generate();
  const stranger = Keypair.generate();
  const underwriter = Keypair.generate();
  const titleAgent = Keypair.generate();
  const recoveryAgent = Keypair.generate();

  let usdcMint: PublicKey;
  let adminUsdc: PublicKey;
  let treasury: PublicKey;
  let strangerUsdc: PublicKey;

  const poolIdA = new BN(1);
  let pool: PublicKey;
  let vault: PublicKey;
  let firstLossVault: PublicKey;
  let reserveVault: PublicKey;
  let shareMint: PublicKey;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const houseParams = (poolId: BN, over: Record<string, unknown> = {}) => ({
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
    ...over,
  });

  const accountsFor = (poolId: BN, adminKey: PublicKey) => {
    const p = pda([Buffer.from("pool"), adminKey.toBuffer(), poolId.toArrayLike(Buffer, "le", 8)]);
    return {
      pool: p,
      vault: pda([Buffer.from("vault"), p.toBuffer()]),
      firstLossVault: pda([Buffer.from("first_loss"), p.toBuffer()]),
      reserveVault: pda([Buffer.from("reserve"), p.toBuffer()]),
      shareMint: pda([Buffer.from("shares"), p.toBuffer()]),
    };
  };

  /** Bir çağrının belirli hata koduyla reddedildiğini doğrular. */
  const expectError = async (p: Promise<unknown>, code: string) => {
    try {
      await p;
    } catch (e: any) {
      const got = e?.error?.errorCode?.code ?? e?.toString();
      assert.include(String(got), code, `beklenen ${code}, gelen ${got}`);
      return;
    }
    assert.fail(`${code} ile reddedilmesi bekleniyordu`);
  };

  const airdrop = async (to: PublicKey, sol = 5) => {
    const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    const bh = await conn.getLatestBlockhash();
    await conn.confirmTransaction({ signature: sig, ...bh });
  };

  const usdcBalance = async (ata: PublicKey) => (await getAccount(conn, ata)).amount;

  const depositAccounts = (who: Keypair, usdcAta: PublicKey, sharesAta: PublicKey) => ({
    depositor: who.publicKey,
    pool,
    depositorUsdc: usdcAta,
    vault,
    shareMint,
    depositorShares: sharesAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  });

  let aUsdc: PublicKey, aShares: PublicKey, bUsdc: PublicKey, bShares: PublicKey;

  before(async () => {
    for (const k of [investorA, investorB, stranger]) await airdrop(k.publicKey);
    usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);
    adminUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, admin.publicKey);
    treasury = await createAssociatedTokenAccount(conn, admin, usdcMint, Keypair.generate().publicKey);
    aUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, investorA.publicKey);
    bUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, investorB.publicKey);
    strangerUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, stranger.publicKey);
    await mintTo(conn, admin, usdcMint, adminUsdc, admin, 1_000_000n * USDC);
    await mintTo(conn, admin, usdcMint, aUsdc, admin, 10_000n * USDC);
    await mintTo(conn, admin, usdcMint, bUsdc, admin, 10_000n * USDC);
    await mintTo(conn, admin, usdcMint, strangerUsdc, admin, 10_000n * USDC);
  });

  describe("create_pool", () => {
    it("ev havuzunu kurar ve parametreleri yazar", async () => {
      const a = accountsFor(poolIdA, admin.publicKey);
      ({ pool, vault, firstLossVault, reserveVault, shareMint } = a);
      await program.methods
        .createPool(houseParams(poolIdA))
        .accountsPartial({
          admin: admin.publicKey,
          ...a,
          usdcMint,
          platformTreasury: treasury,
          reserveVault: a.reserveVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      const p = await program.account.pool.fetch(pool);
      assert.equal(p.admin.toBase58(), admin.publicKey.toBase58());
      assert.equal(p.maxLtvBps, 7000);
      assert.equal(p.rateBps, 700);
      assert.equal(p.termMonths, 240);
      assert.equal(p.recoveryCoeffBps, 6300);
      assert.deepEqual(p.provisionBps, [0, 500, 1500, 1500]);
      assert.equal(p.brakeReserveBps, 25);
      assert.equal(p.usdcMint.toBase58(), usdcMint.toBase58());
      assert.equal(p.platformTreasury.toBase58(), treasury.toBase58());
      assert.equal(p.idleCash.toString(), "0");
      assert.equal(p.totalShares.toString(), "0");
      assert.equal(p.nextLoanId.toString(), "0");
      assert.deepEqual(p.status, { active: {} });
      assert.deepEqual(Array.from(p.reserved), new Array(64).fill(0));

      // token hesapları ve pay mint'i doğru authority ile açıldı
      for (const v of [vault, firstLossVault, reserveVault]) {
        const acc = await getAccount(conn, v);
        assert.equal(acc.owner.toBase58(), pool.toBase58());
        assert.equal(acc.mint.toBase58(), usdcMint.toBase58());
      }
      const mint = await getMint(conn, shareMint);
      assert.equal(mint.mintAuthority?.toBase58(), pool.toBase58());
      assert.equal(mint.decimals, 6);
    });

    const rejectedCases: [string, Record<string, unknown>][] = [
      ["max_ltv > 9700", { maxLtvBps: 9701 }],
      ["rate = 0", { rateBps: 0 }],
      ["rate > 2000", { rateBps: 2001 }],
      ["term = 0", { termMonths: 0 }],
      ["term > 360", { termMonths: 361 }],
      ["recovery_coeff > 10000", { recoveryCoeffBps: 10001 }],
      ["provision azalıyor", { provisionBps: [0, 1500, 500, 1500] }],
      ["provision > 10000", { provisionBps: [0, 500, 1500, 10001] }],
      ["buffer > 5000", { bufferBps: 5001 }],
      ["min_first_loss > 10000", { minFirstLossBps: 10001 }],
      ["brake_late > 10000", { brakeLateBps: 10001 }],
      ["brake_reserve > 10000", { brakeReserveBps: 10001 }],
      ["period = 0", { periodSeconds: new BN(0) }],
      ["grace >= period", { graceSeconds: new BN(60) }],
      ["fee > 100", { entryExitFeeBps: 101 }],
    ];
    rejectedCases.forEach(([name, over], i) => {
      it(`sınır dışı parametre reddedilir: ${name}`, async () => {
        const id = new BN(100 + i);
        const a = accountsFor(id, admin.publicKey);
        await expectError(
          program.methods
            .createPool(houseParams(id, over))
            .accountsPartial({
              admin: admin.publicKey,
              ...a,
              usdcMint,
              platformTreasury: treasury,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
              rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc(),
          "ParamOutOfBounds",
        );
      });
    });

    it("2008 modu (LTV %97, first_loss 0) sınırlardan geçer", async () => {
      const id = new BN(200);
      const a = accountsFor(id, admin.publicKey);
      await program.methods
        .createPool(houseParams(id, { maxLtvBps: 9700, minFirstLossBps: 0 }))
        .accountsPartial({
          admin: admin.publicKey,
          ...a,
          usdcMint,
          platformTreasury: treasury,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      const p = await program.account.pool.fetch(a.pool);
      assert.equal(p.maxLtvBps, 9700);
      assert.equal(p.minFirstLossBps, 0);
    });

    it("aynı havuz ikinci kez açılamaz (reinit yok)", async () => {
      const a = accountsFor(poolIdA, admin.publicKey);
      let failed = false;
      try {
        await program.methods
          .createPool(houseParams(poolIdA))
          .accountsPartial({
            admin: admin.publicKey,
            ...a,
            usdcMint,
            platformTreasury: treasury,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .rpc();
      } catch {
        failed = true;
      }
      assert.isTrue(failed);
    });
  });

  describe("fund_first_loss", () => {
    const ffl = (signer: Keypair, from: PublicKey, amount: bigint) =>
      program.methods
        .fundFirstLoss(new BN(amount.toString()))
        .accountsPartial({
          admin: signer.publicKey,
          pool,
          adminTokenAccount: from,
          firstLossVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([signer])
        .rpc();

    it("admin ilk zarar kasasını doldurur", async () => {
      await ffl(admin, adminUsdc, 350_000n * USDC);
      const p = await program.account.pool.fetch(pool);
      assert.equal(p.firstLossBalance.toString(), (350_000n * USDC).toString());
      assert.equal((await usdcBalance(firstLossVault)).toString(), (350_000n * USDC).toString());
    });

    it("yetkisiz çağrı reddedilir", async () => {
      await expectError(ffl(stranger, strangerUsdc, 1n * USDC), "Unauthorized");
    });

    it("sıfır tutar reddedilir", async () => {
      await expectError(ffl(admin, adminUsdc, 0n), "ZeroAmount");
    });
  });

  describe("deposit", () => {
    before(async () => {
      aShares = await createAssociatedTokenAccount(conn, admin, shareMint, investorA.publicKey);
      bShares = await createAssociatedTokenAccount(conn, admin, shareMint, investorB.publicKey);
    });

    const dep = (who: Keypair, usdcAta: PublicKey, sharesAta: PublicKey, amount: bigint) =>
      program.methods
        .deposit(new BN(amount.toString()))
        .accountsPartial(depositAccounts(who, usdcAta, sharesAta))
        .signers([who])
        .rpc();

    const shareBalance = async (ata: PublicKey) => (await getAccount(conn, ata)).amount;

    it("ilk yatırım: pay nav.rs ile aynı, vault ve sayaçlar tutarlı", async () => {
      const amount = 1_000n * USDC;
      const q = m.depositQuote(amount, 20, 0n, 0n);
      await dep(investorA, aUsdc, aShares, amount);

      assert.equal((await shareBalance(aShares)).toString(), q.shares.toString());
      const p = await program.account.pool.fetch(pool);
      assert.equal(p.idleCash.toString(), amount.toString());
      assert.equal(p.totalShares.toString(), q.shares.toString());
      assert.equal((await usdcBalance(vault)).toString(), amount.toString());
      assert.equal((await getMint(conn, shareMint)).supply.toString(), q.shares.toString());
    });

    it("ardışık ikinci yatırımcıda pay fiyatı sabit kalır (ücret hariç)", async () => {
      const before = await program.account.pool.fetch(pool);
      const nav = m.seniorNav({
        idleCash: BigInt(before.idleCash.toString()),
        totalOutstanding: 0n,
        lossProvision: 0n,
        firstLossBalance: 0n,
        reserveBalance: 0n,
      });
      const price0 = m.sharePrice(nav, BigInt(before.totalShares.toString()));

      const amount = 500n * USDC;
      const q = m.depositQuote(amount, 20, BigInt(before.totalShares.toString()), nav);
      await dep(investorB, bUsdc, bShares, amount);
      assert.equal((await shareBalance(bShares)).toString(), q.shares.toString());

      const after = await program.account.pool.fetch(pool);
      const nav2 = BigInt(after.idleCash.toString());
      const price1 = m.sharePrice(nav2, BigInt(after.totalShares.toString()));
      // ücret havuzda kaldığı için fiyat azalmaz; yalnızca ücret kadar (çok az) artar
      assert.isTrue(price1 >= price0, "pay fiyatı düşmemeli");
      assert.isTrue(price1 - price0 < m.SCALE / 1000n, "fiyat %0,1'den fazla oynamamalı");
    });

    it("sıfır tutar reddedilir", async () => {
      await expectError(dep(investorA, aUsdc, aShares, 0n), "ZeroAmount");
    });

    it("başkasının pay hesabına yatırım reddedilir", async () => {
      await expectError(dep(investorA, aUsdc, bShares, 10n * USDC), "Unauthorized");
    });

    it("vault'a doğrudan bağış NAV'ı ve sonraki payları değiştirmez", async () => {
      const before = await program.account.pool.fetch(pool);
      const totalShares = BigInt(before.totalShares.toString());
      const nav = BigInt(before.idleCash.toString());
      const expected = m.depositQuote(100n * USDC, 20, totalShares, nav);

      // saldırgan vault'a 5.000 USDC bağışlar (sayaçlara girmez)
      await transfer(conn, stranger, strangerUsdc, vault, stranger, 5_000n * USDC);

      const sharesBefore = await shareBalance(aShares);
      await dep(investorA, aUsdc, aShares, 100n * USDC);
      const minted = (await shareBalance(aShares)) - sharesBefore;
      assert.equal(minted.toString(), expected.shares.toString(), "bağış pay sayısını etkiledi");

      // invariant: vault fazlalık taşır (≥ idle_cash)
      const p = await program.account.pool.fetch(pool);
      assert.isTrue((await usdcBalance(vault)) >= BigInt(p.idleCash.toString()));
    });
  });

  describe("apply_loan", () => {
    const borrower = Keypair.generate();
    const seller = Keypair.generate();
    let borrowerUsdc: PublicKey;

    const loanPda = (id: number) =>
      pda([Buffer.from("loan"), pool.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)]);
    const escrowPda = (loan: PublicKey) => pda([Buffer.from("escrow"), loan.toBuffer()]);
    const collateralPda = (loan: PublicKey) => pda([Buffer.from("collateral"), loan.toBuffer()]);

    before(async () => {
      for (const k of [borrower, seller]) await airdrop(k.publicKey);
      borrowerUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, borrower.publicKey);
      await mintTo(conn, admin, usdcMint, borrowerUsdc, admin, 100_000n * USDC);
    });

    const apply = async (
      price: bigint,
      down: bigint,
      opts: { seller?: Keypair; borrowerKp?: Keypair } = {}
    ) => {
      const p = await program.account.pool.fetch(pool);
      const id = Number(p.nextLoanId.toString());
      const loan = loanPda(id);
      const sellerKp = opts.seller ?? seller;
      const borrowerKp = opts.borrowerKp ?? borrower;
      await program.methods
        .applyLoan(new BN(price.toString()), new BN(down.toString()))
        .accountsPartial({
          borrower: borrowerKp.publicKey,
          seller: sellerKp.publicKey,
          pool,
          loan,
          usdcMint,
          borrowerUsdc,
          loanEscrow: escrowPda(loan),
          collateralEscrow: collateralPda(loan),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([borrowerKp, sellerKp])
        .rpc();
      return loan;
    };

    it("borrower == seller reddedilir", async () => {
      await expectError(
        apply(100_000n * USDC, 30_000n * USDC, { seller: borrower }),
        "SellerIsBorrower"
      );
    });

    it("düşük peşinat reddedilir", async () => {
      await expectError(apply(100_000n * USDC, 29_999n * USDC), "InsufficientDownPayment");
    });

    it("peşinat fiyata eşit ya da büyükse reddedilir", async () => {
      await expectError(apply(100_000n * USDC, 100_000n * USDC), "ZeroAmount");
    });

    it("Maria: escrow 30.700, teminat 1.628, durum Pending", async () => {
      const before = await program.account.pool.fetch(pool);
      const balBefore = await usdcBalance(borrowerUsdc);
      const price = 100_000n * USDC;
      const down = 30_000n * USDC;
      const loan = await apply(price, down);

      const principal = price - down;
      const inst = m.installment(principal, 700, 240);
      const l = await program.account.loan.fetch(loan);
      assert.equal(l.id.toString(), before.nextLoanId.toString());
      assert.deepEqual(l.status, { pending: {} });
      assert.equal(l.principal.toString(), principal.toString());
      assert.equal(l.installment.toString(), inst.toString());
      assert.equal(l.remainingPrincipal.toString(), principal.toString());
      assert.equal(l.borrower.toBase58(), borrower.publicKey.toBase58());
      assert.equal(l.seller.toBase58(), seller.publicKey.toBase58());

      assert.equal((await usdcBalance(escrowPda(loan))).toString(), (30_700n * USDC).toString());
      const collateral = await usdcBalance(collateralPda(loan));
      assert.equal(collateral.toString(), m.collateralAmount(inst).toString());
      assert.equal(collateral / USDC, 1_628n);
      assert.equal(
        (balBefore - (await usdcBalance(borrowerUsdc))).toString(),
        (30_700n * USDC + collateral).toString()
      );

      const after = await program.account.pool.fetch(pool);
      assert.equal(Number(after.nextLoanId.toString()), Number(before.nextLoanId.toString()) + 1);
      // idle_cash'e dokunulmaz: peşinat/teminat havuz parası değil
      assert.equal(after.idleCash.toString(), before.idleCash.toString());
    });

    it("ikinci başvuru yeni id alır", async () => {
      const loan = await apply(20_000n * USDC, 8_000n * USDC);
      const l = await program.account.loan.fetch(loan);
      assert.equal(l.id.toString(), "1");
    });

    describe("approve_loan", () => {
      const docHash = Array.from({ length: 32 }, (_, i) => i + 1);
      const assetHash = Array.from({ length: 32 }, (_, i) => 200 - i);

      const decide = (
        loan: PublicKey,
        decision: { approve: {} } | { reject: {} },
        appraised: bigint,
        signer: Keypair = underwriter
      ) =>
        program.methods
          .approveLoan(decision, new BN(appraised.toString()), docHash, assetHash, 4034, true, true)
          .accountsPartial({
            underwriter: signer.publicKey,
            pool,
            loan,
            borrower: borrower.publicKey,
            borrowerUsdc,
            loanEscrow: escrowPda(loan),
            collateralEscrow: collateralPda(loan),
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([signer])
          .rpc();

      before(async () => {
        await airdrop(underwriter.publicKey);
      });

      it("underwriter dışı imzacı reddedilir", async () => {
        await expectError(decide(loanPda(0), { approve: {} }, 100_000n * USDC, stranger), "Unauthorized");
      });

      it("düşük ekspertizde Approve reddedilir (AppraisalTooLow)", async () => {
        // loan 0: fiyat 100k, principal 70k; ekspertiz 90k → izin 63k < 70k
        await expectError(decide(loanPda(0), { approve: {} }, 90_000n * USDC), "AppraisalTooLow");
        const l = await program.account.loan.fetch(loanPda(0));
        assert.deepEqual(l.status, { pending: {} });
      });

      it("Approve: alanlar yazılır, durum Approved, değer bandı 50k", async () => {
        await decide(loanPda(0), { approve: {} }, 120_000n * USDC);
        const l = await program.account.loan.fetch(loanPda(0));
        assert.deepEqual(l.status, { approved: {} });
        assert.equal(l.appraisedValue.toString(), (120_000n * USDC).toString());
        assert.equal(l.valueBand.toString(), (100_000n * USDC).toString());
        assert.equal(l.regionCode, 4034);
        assert.isTrue(l.incomeOk && l.currencyOk);
        assert.deepEqual(Array.from(l.docHash), docHash);
        assert.deepEqual(Array.from(l.assetRefHash), assetHash);
        // escrow'lar yerinde ve dokunulmamış
        assert.equal((await usdcBalance(escrowPda(loanPda(0)))).toString(), (30_700n * USDC).toString());
      });

      it("yanlış durumda (Approved) tekrar karar reddedilir", async () => {
        await expectError(decide(loanPda(0), { approve: {} }, 120_000n * USDC), "InvalidStatus");
        await expectError(decide(loanPda(0), { reject: {} }, 0n), "InvalidStatus");
      });

      it("Reject: borçlu bakiyesi tam iade, hesaplar kapanır, durum Rejected", async () => {
        const loan = loanPda(1);
        const inst = m.installment(12_000n * USDC, 700, 240);
        const locked = 8_120n * USDC + m.collateralAmount(inst);
        const before = await usdcBalance(borrowerUsdc);
        assert.equal((await usdcBalance(escrowPda(loan))).toString(), (8_120n * USDC).toString());

        await decide(loan, { reject: {} }, 0n);

        assert.equal((await usdcBalance(borrowerUsdc) - before).toString(), locked.toString());
        assert.isNull(await conn.getAccountInfo(escrowPda(loan)));
        assert.isNull(await conn.getAccountInfo(collateralPda(loan)));
        const l = await program.account.loan.fetch(loan);
        assert.deepEqual(l.status, { rejected: {} });
      });
    });
  });

  describe("fund_loan", () => {
    const buyer = Keypair.generate();
    const seller2 = Keypair.generate();
    const docHash = Array.from({ length: 32 }, () => 7);
    const assetHash = Array.from({ length: 32 }, () => 9);
    let buyerUsdc: PublicKey;

    type Ctx = ReturnType<typeof accountsFor>;

    const loanPdaOf = (c: Ctx, id: number) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("loan"), c.pool.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
        program.programId
      )[0];
    const escrowOf = (loan: PublicKey) => pda([Buffer.from("escrow"), loan.toBuffer()]);

    const depositTo = async (c: Ctx, amount: bigint) => {
      const shares = (
        await getOrCreateAssociatedTokenAccount(conn, admin, c.shareMint, investorA.publicKey)
      ).address;
      await mintTo(conn, admin, usdcMint, aUsdc, admin, amount);
      await program.methods
        .deposit(new BN(amount.toString()))
        .accountsPartial({
          depositor: investorA.publicKey,
          pool: c.pool,
          depositorUsdc: aUsdc,
          vault: c.vault,
          shareMint: c.shareMint,
          depositorShares: shares,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([investorA])
        .rpc();
    };

    const addFirstLoss = (c: Ctx, amount: bigint) =>
      program.methods
        .fundFirstLoss(new BN(amount.toString()))
        .accountsPartial({
          admin: admin.publicKey,
          pool: c.pool,
          adminTokenAccount: adminUsdc,
          firstLossVault: c.firstLossVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

    const mkPool = async (id: number, over: Record<string, unknown>, firstLoss: bigint, dep: bigint) => {
      const a = accountsFor(new BN(id), admin.publicKey);
      await program.methods
        .createPool(houseParams(new BN(id), over))
        .accountsPartial({
          admin: admin.publicKey,
          ...a,
          usdcMint,
          platformTreasury: treasury,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      if (firstLoss > 0n) await addFirstLoss(a, firstLoss);
      if (dep > 0n) await depositTo(a, dep);
      return a;
    };

    /** Başvuru + onay; loan ve escrow adreslerini döner. */
    const approvedLoan = async (c: Ctx, price: bigint, down: bigint, approve = true) => {
      const p = await program.account.pool.fetch(c.pool);
      const loan = loanPdaOf(c, Number(p.nextLoanId.toString()));
      const escrow = escrowOf(loan);
      const collateral = pda([Buffer.from("collateral"), loan.toBuffer()]);
      await program.methods
        .applyLoan(new BN(price.toString()), new BN(down.toString()))
        .accountsPartial({
          borrower: buyer.publicKey,
          seller: seller2.publicKey,
          pool: c.pool,
          loan,
          usdcMint,
          borrowerUsdc: buyerUsdc,
          loanEscrow: escrow,
          collateralEscrow: collateral,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer, seller2])
        .rpc();
      if (approve) await program.methods
        .approveLoan({ approve: {} }, new BN(price.toString()), docHash, assetHash, 1, true, true)
        .accountsPartial({
          underwriter: underwriter.publicKey,
          pool: c.pool,
          loan,
          borrower: buyer.publicKey,
          borrowerUsdc: buyerUsdc,
          loanEscrow: escrow,
          collateralEscrow: collateral,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([underwriter])
        .rpc();
      return { loan, escrow };
    };

    const fund = (c: Ctx, loan: PublicKey, escrow: PublicKey, caller: Keypair = stranger) =>
      program.methods
        .fundLoan()
        .accountsPartial({
          caller: caller.publicKey,
          pool: c.pool,
          loan,
          vault: c.vault,
          loanEscrow: escrow,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([caller])
        .rpc();

    const poolA = () => accountsFor(poolIdA, admin.publicKey);

    before(async () => {
      await airdrop(buyer.publicKey);
      await airdrop(seller2.publicKey);
      await airdrop(underwriter.publicKey);
      buyerUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, buyer.publicKey);
      await mintTo(conn, admin, usdcMint, buyerUsdc, admin, 200_000n * USDC);
    });

    it("idle_cash < principal: likidite tamponu reddedilir", async () => {
      const a = poolA();
      const { loan, escrow } = await approvedLoan(a, 100_000n * USDC, 30_000n * USDC);
      await expectError(fund(a, loan, escrow), "LiquidityBufferBreached");
      const l = await program.account.loan.fetch(loan);
      assert.deepEqual(l.status, { approved: {} });
    });

    it("idle − principal < %10 NAV: tampon reddedilir", async () => {
      // idle ≈ 75k, principal 70k → kalan 5k < tampon 7,5k.
      const a = poolA();
      const p = await program.account.pool.fetch(a.pool);
      const need = 75_000n * USDC - BigInt(p.idleCash.toString());
      await depositTo(a, (need * 1000n) / 998n);
      const loan = loanPdaOf(a, 2);
      await expectError(fund(a, loan, escrowOf(loan)), "LiquidityBufferBreached");
    });

    it("permissionless: yabancı çağıran fonlar; sayaçlar ve escrow doğru", async () => {
      const a = poolA();
      await depositTo(a, 60_000n * USDC); // tampon rahat aşılır
      const loan = loanPdaOf(a, 2);
      const escrow = escrowOf(loan);
      const before = await program.account.pool.fetch(a.pool);
      const strangerBefore = await usdcBalance(strangerUsdc);
      const principal = 70_000n * USDC;

      await fund(a, loan, escrow, stranger);

      const after = await program.account.pool.fetch(a.pool);
      assert.equal(
        (BigInt(before.idleCash.toString()) - BigInt(after.idleCash.toString())).toString(),
        principal.toString()
      );
      assert.equal(after.totalOutstanding.toString(), principal.toString());
      assert.equal(after.reservePending.toString(), (350n * USDC).toString()); // ücret 700 / 2
      assert.equal(after.reserveBalance.toString(), "0");
      const l = await program.account.loan.fetch(loan);
      assert.deepEqual(l.status, { funded: {} });
      assert.equal(l.titleDeadline.toNumber() - l.fundedAt.toNumber(), 3600);
      // escrow = fiyat + ücret = 100.700
      assert.equal((await usdcBalance(escrow)).toString(), (100_700n * USDC).toString());
      // çağıranın USDC'si değişmez
      assert.equal((await usdcBalance(strangerUsdc)).toString(), strangerBefore.toString());
      assert.isTrue((await usdcBalance(a.vault)) >= BigInt(after.idleCash.toString()));
    });

    it("zaten Funded olan kredi ikinci kez fonlanamaz", async () => {
      const a = poolA();
      const loan = loanPdaOf(a, 2);
      await expectError(fund(a, loan, escrowOf(loan)), "InvalidStatus");
    });

    it("yedek fon freni açıkken yeni kredi reddedilir (karar 1)", async () => {
      // brake_reserve %100: ilk kredide outstanding 0 → geçer; ikincide pending 350 < 70k → fren.
      const c = await mkPool(31, { brakeReserveBps: 10000 }, 350_000n * USDC, 400_000n * USDC);
      const first = await approvedLoan(c, 100_000n * USDC, 30_000n * USDC);
      await fund(c, first.loan, first.escrow);
      const second = await approvedLoan(c, 100_000n * USDC, 30_000n * USDC);
      await expectError(fund(c, second.loan, second.escrow), "BrakeReserve");
    });

    it("yetersiz ilk zarar kasası reddedilir (%5 kuralı)", async () => {
      // min %5 × 70k = 3.500 gerekir.
      const c = await mkPool(32, {}, 0n, 400_000n * USDC);
      const x = await approvedLoan(c, 100_000n * USDC, 30_000n * USDC);
      await expectError(fund(c, x.loan, x.escrow), "InsufficientFirstLoss");
      await addFirstLoss(c, 3_000n * USDC); // hâlâ yetersiz
      await expectError(fund(c, x.loan, x.escrow), "InsufficientFirstLoss");
      await addFirstLoss(c, 500n * USDC); // 3.500: tam eşik geçer
      await fund(c, x.loan, x.escrow);
    });

    describe("confirm_title / cancel_funding", () => {
      let sellerUsdc: PublicKey;

      const confirm = (c: Ctx, loan: PublicKey, signer: Keypair = titleAgent) =>
        program.methods
          .confirmTitle()
          .accountsPartial({
            titleAgent: signer.publicKey,
            pool: c.pool,
            loan,
            loanEscrow: escrowOf(loan),
            sellerUsdc,
            reserveVault: c.reserveVault,
            platformTreasury: treasury,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([signer])
          .rpc();

      const cancel = (c: Ctx, loan: PublicKey, caller: Keypair = stranger) =>
        program.methods
          .cancelFunding()
          .accountsPartial({
            caller: caller.publicKey,
            pool: c.pool,
            loan,
            vault: c.vault,
            loanEscrow: escrowOf(loan),
            collateralEscrow: pda([Buffer.from("collateral"), loan.toBuffer()]),
            borrower: buyer.publicKey,
            borrowerUsdc: buyerUsdc,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([caller])
          .rpc();

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      before(async () => {
        await airdrop(titleAgent.publicKey);
        sellerUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, seller2.publicKey);
        await mintTo(conn, admin, usdcMint, buyerUsdc, admin, 100_000n * USDC);
      });

      it("title_agent dışı imzacı reddedilir", async () => {
        const a = poolA();
        await expectError(confirm(a, loanPdaOf(a, 2), stranger), "Unauthorized");
      });

      it("confirm_title: satıcıya fiyat, ücret yarı yarıya Reserve/platform, Active", async () => {
        const a = poolA();
        const loan = loanPdaOf(a, 2);
        const before = await program.account.pool.fetch(a.pool);
        const sellerBefore = await usdcBalance(sellerUsdc);
        const reserveBefore = await usdcBalance(a.reserveVault);
        const treasuryBefore = await usdcBalance(treasury);

        await confirm(a, loan);

        assert.equal((await usdcBalance(sellerUsdc) - sellerBefore).toString(), (100_000n * USDC).toString());
        assert.equal((await usdcBalance(a.reserveVault) - reserveBefore).toString(), (350n * USDC).toString());
        assert.equal((await usdcBalance(treasury) - treasuryBefore).toString(), (350n * USDC).toString());
        assert.equal((await usdcBalance(escrowOf(loan))).toString(), "0");

        const after = await program.account.pool.fetch(a.pool);
        assert.equal(after.reservePending.toString(), "0");
        assert.equal(
          (BigInt(after.reserveBalance.toString()) - BigInt(before.reserveBalance.toString())).toString(),
          (350n * USDC).toString()
        );
        // idle ve outstanding değişmez
        assert.equal(after.idleCash.toString(), before.idleCash.toString());
        assert.equal(after.totalOutstanding.toString(), before.totalOutstanding.toString());

        const l = await program.account.loan.fetch(loan);
        assert.deepEqual(l.status, { active: {} });
        assert.isAtLeast(l.nextDue.toNumber(), l.fundedAt.toNumber() + 60);
        assert.isAtMost(l.nextDue.toNumber(), l.fundedAt.toNumber() + 3600 + 60);
      });

      it("Active krediyi tekrar onaylamak reddedilir", async () => {
        const a = poolA();
        await expectError(confirm(a, loanPdaOf(a, 2)), "InvalidStatus");
      });

      it("süre aşımı: confirm_title TitleDeadlinePassed; cancel_funding herkesçe çağrılır", async () => {
        const c = await mkPool(41, { titleTimeoutSeconds: new BN(2) }, 10_000n * USDC, 400_000n * USDC);
        const { loan, escrow } = await approvedLoan(c, 100_000n * USDC, 30_000n * USDC);
        await fund(c, loan, escrow);
        const funded = await program.account.pool.fetch(c.pool);
        assert.equal(funded.totalOutstanding.toString(), (70_000n * USDC).toString());
        assert.equal(funded.reservePending.toString(), (350n * USDC).toString());

        await sleep(5000);
        await expectError(confirm(c, loan), "TitleDeadlinePassed");

        const buyerBefore = await usdcBalance(buyerUsdc);
        const strangerBefore = await usdcBalance(strangerUsdc);
        await cancel(c, loan, stranger);

        // alıcıya peşinat + ücret + teminat tam iade
        const inst = m.installment(70_000n * USDC, 700, 240);
        const refund = 30_700n * USDC + m.collateralAmount(inst);
        assert.equal((await usdcBalance(buyerUsdc) - buyerBefore).toString(), refund.toString());
        assert.equal((await usdcBalance(strangerUsdc)).toString(), strangerBefore.toString());
        // anapara vault'a döndü; sayaçlar geri alındı
        const after = await program.account.pool.fetch(c.pool);
        assert.equal(after.idleCash.toString(), funded.idleCash.add(new BN((70_000n * USDC).toString())).toString());
        assert.equal(after.totalOutstanding.toString(), "0");
        assert.equal(after.reservePending.toString(), "0");
        assert.equal(after.reserveBalance.toString(), "0");
        assert.isTrue((await usdcBalance(c.vault)) >= BigInt(after.idleCash.toString()));
        assert.isNull(await conn.getAccountInfo(escrowOf(loan)));
        assert.isNull(await conn.getAccountInfo(pda([Buffer.from("collateral"), loan.toBuffer()])));
        const l = await program.account.loan.fetch(loan);
        assert.deepEqual(l.status, { cancelled: {} });
      });

      it("süre dolmadan cancel_funding reddedilir (TitleDeadlineNotReached)", async () => {
        const c = await mkPool(42, {}, 10_000n * USDC, 400_000n * USDC);
        const { loan, escrow } = await approvedLoan(c, 100_000n * USDC, 30_000n * USDC);
        await fund(c, loan, escrow);
        await expectError(cancel(c, loan), "TitleDeadlineNotReached");
        // süre içinde onay geçerli
        await confirm(c, loan);
      });

    describe("P10 düzeltmeleri: bağış ve pay yakma saldırıları", () => {
      const collateralOf = (loan: PublicKey) => pda([Buffer.from("collateral"), loan.toBuffer()]);
      const donate = (to: PublicKey) => transfer(conn, stranger, strangerUsdc, to, stranger, 1n);
      const reject = (c: Ctx, loan: PublicKey) =>
        program.methods
          .approveLoan({ reject: {} }, new BN(0), docHash, assetHash, 0, false, false)
          .accountsPartial({
            underwriter: underwriter.publicKey,
            pool: c.pool,
            loan,
            borrower: buyer.publicKey,
            borrowerUsdc: buyerUsdc,
            loanEscrow: escrowOf(loan),
            collateralEscrow: collateralOf(loan),
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([underwriter])
          .rpc();

      before(async () => {
        await mintTo(conn, admin, usdcMint, buyerUsdc, admin, 100_000n * USDC);
      });

      it("escrow'a bağış Reject'i kilitlemez; fazlalık borçluya iade edilir", async () => {
        const c = await mkPool(51, {}, 10_000n * USDC, 400_000n * USDC);
        const { loan } = await approvedLoan(c, 100_000n * USDC, 30_000n * USDC, false);
        await donate(escrowOf(loan));
        await donate(collateralOf(loan));

        const inst = m.installment(70_000n * USDC, 700, 240);
        const locked = 30_700n * USDC + m.collateralAmount(inst);
        const before = await usdcBalance(buyerUsdc);
        await reject(c, loan);
        assert.equal((await usdcBalance(buyerUsdc) - before).toString(), (locked + 2n).toString());
        assert.isNull(await conn.getAccountInfo(escrowOf(loan)));
        assert.isNull(await conn.getAccountInfo(collateralOf(loan)));
      });

      it("escrow'a bağış approve/fund/confirm akışını kilitlemez", async () => {
        const c = await mkPool(52, {}, 10_000n * USDC, 400_000n * USDC);
        const { loan, escrow } = await approvedLoan(c, 100_000n * USDC, 30_000n * USDC);
        await donate(escrow);
        await donate(collateralOf(loan));
        await fund(c, loan, escrow);
        await donate(escrow); // Funded iken de bağış yapılabilir

        const sellerBefore = await usdcBalance(sellerUsdc);
        await confirm(c, loan);
        assert.equal((await usdcBalance(sellerUsdc) - sellerBefore).toString(), (100_000n * USDC).toString());
        const l = await program.account.loan.fetch(loan);
        assert.deepEqual(l.status, { active: {} });
        // yalnızca bağışlar escrow'da kalır
        assert.equal((await usdcBalance(escrow)).toString(), "2");
      });

      it("escrow'a bağış cancel_funding'i kilitlemez; fazlalık borçluya gider", async () => {
        const c = await mkPool(53, { titleTimeoutSeconds: new BN(2) }, 10_000n * USDC, 400_000n * USDC);
        const { loan, escrow } = await approvedLoan(c, 100_000n * USDC, 30_000n * USDC);
        await fund(c, loan, escrow);
        await donate(escrow);
        await donate(collateralOf(loan));
        await sleep(5000);

        const inst = m.installment(70_000n * USDC, 700, 240);
        const refund = 30_700n * USDC + m.collateralAmount(inst);
        const before = await usdcBalance(buyerUsdc);
        await cancel(c, loan);
        assert.equal((await usdcBalance(buyerUsdc) - before).toString(), (refund + 2n).toString());
        const after = await program.account.pool.fetch(c.pool);
        assert.equal(after.totalOutstanding.toString(), "0");
        assert.isNull(await conn.getAccountInfo(escrow));
      });

      it("pay yakmak deposit'i kilitlemez (supply ≤ total_shares)", async () => {
        const c = await mkPool(54, {}, 0n, 1_000n * USDC);
        const shares = (
          await getOrCreateAssociatedTokenAccount(conn, admin, c.shareMint, investorA.publicKey)
        ).address;
        await burn(conn, investorA, shares, c.shareMint, investorA, 1n);
        const p = await program.account.pool.fetch(c.pool);
        assert.isTrue((await getMint(conn, c.shareMint)).supply < BigInt(p.totalShares.toString()));

        await depositTo(c, 500n * USDC); // yakma sonrası da yatırım çalışır
        const after = await program.account.pool.fetch(c.pool);
        assert.isTrue(BigInt(after.totalShares.toString()) > BigInt(p.totalShares.toString()));
      });
    });
    });
  });
});
