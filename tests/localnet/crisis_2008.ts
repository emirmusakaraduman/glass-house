// P14: 2008 modu havuzu (max_ltv %97, min_first_loss 0, brake_reserve 0) zincirde çalışır.
// create-pools.ts'teki crisis2008 parametreleriyle aynı değerler. Aynı kredi normal ev
// havuzunda (%70, ilk zarar %5) reddedilir; 2008 modunda geçer.
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import type { Glasshouse } from "../../target/types/glasshouse";
import * as m from "../helpers/loanMath";

const USDC = 1_000_000n;

describe("2008 modu havuzu", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.glasshouse as Program<Glasshouse>;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const investor = Keypair.generate();
  const buyer = Keypair.generate();
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

  const accountsOf = (id: number) => {
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
  type Pool = ReturnType<typeof accountsOf>;
  const loanOf = (c: Pool, n: number) => pda([Buffer.from("loan"), c.pool.toBuffer(), le8(n)]);
  const escrowOf = (loan: PublicKey) => pda([Buffer.from("escrow"), loan.toBuffer()]);
  const collateralOf = (loan: PublicKey) => pda([Buffer.from("collateral"), loan.toBuffer()]);

  let usdcMint: PublicKey, treasury: PublicKey;
  let investorUsdc: PublicKey, buyerUsdc: PublicKey, sellerUsdc: PublicKey;

  const common = {
    underwriter: underwriter.publicKey,
    titleAgent: titleAgent.publicKey,
    recoveryAgent: admin.publicKey,
    assetType: { house: {} },
    rateBps: 700,
    termMonths: 240,
    recoveryCoeffBps: 6300,
    graceSeconds: new BN(10),
    periodSeconds: new BN(60),
    provisionBps: [0, 500, 1500, 1500],
    bufferBps: 1000,
    brakeLateBps: 1000,
    entryExitFeeBps: 20,
    minRecoveryBps: 0,
    titleTimeoutSeconds: new BN(3600),
  };
  const normal = { ...common, maxLtvBps: 7000, brakeReserveBps: 25, minFirstLossBps: 500 };
  const crisis = { ...common, maxLtvBps: 9700, brakeReserveBps: 0, minFirstLossBps: 0 };

  const N = accountsOf(931); // normal ev havuzu (karşılaştırma)
  const C = accountsOf(932); // 2008 modu

  const createPool = (c: Pool, params: Record<string, unknown>) =>
    program.methods
      .createPool({ ...params, poolId: new BN(c.id) } as any)
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

  const deposit = async (c: Pool, amount: bigint) => {
    const shares = await createAssociatedTokenAccount(conn, admin, c.shareMint, investor.publicKey);
    await program.methods
      .deposit(new BN(amount.toString()))
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

  const apply = (c: Pool, n: number, price: bigint, down: bigint) =>
    program.methods
      .applyLoan(new BN(price.toString()), new BN(down.toString()))
      .accountsPartial({
        borrower: buyer.publicKey,
        seller: seller.publicKey,
        pool: c.pool,
        loan: loanOf(c, n),
        usdcMint,
        borrowerUsdc: buyerUsdc,
        loanEscrow: escrowOf(loanOf(c, n)),
        collateralEscrow: collateralOf(loanOf(c, n)),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer, seller])
      .rpc();

  const approve = (c: Pool, n: number, appraised: bigint) =>
    program.methods
      .approveLoan({ approve: {} }, new BN(appraised.toString()), Array(32).fill(5), Array(32).fill(6), 3401, true, true)
      .accountsPartial({
        underwriter: underwriter.publicKey,
        pool: c.pool,
        loan: loanOf(c, n),
        borrower: buyer.publicKey,
        borrowerUsdc: buyerUsdc,
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

  before(async () => {
    for (const k of [investor, buyer, seller, underwriter, titleAgent, crank]) await airdrop(k.publicKey);
    usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);
    treasury = await createAssociatedTokenAccount(conn, admin, usdcMint, Keypair.generate().publicKey);
    investorUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, investor.publicKey);
    buyerUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, buyer.publicKey);
    sellerUsdc = await createAssociatedTokenAccount(conn, admin, usdcMint, seller.publicKey);
    await mintTo(conn, admin, usdcMint, investorUsdc, admin, 1_000_000n * USDC);
    await mintTo(conn, admin, usdcMint, buyerUsdc, admin, 50_000n * USDC);
    await createPool(N, normal);
    await createPool(C, crisis);
    await deposit(N, 400_000n * USDC);
    await deposit(C, 400_000n * USDC);
  });

  const price = 100_000n * USDC;
  const down = 3_000n * USDC; // %3 peşinat → %97 LTV
  const principal = price - down;

  it("2008 modu parametreleri yazıldı; ilk zarar kasası 0", async () => {
    const p = await program.account.pool.fetch(C.pool);
    assert.equal(p.maxLtvBps, 9700);
    assert.equal(p.minFirstLossBps, 0);
    assert.equal(p.brakeReserveBps, 0);
    assert.equal(p.firstLossBalance.toString(), "0");
    assert.equal(p.reserveBalance.toString(), "0");
  });

  it("%3 peşinat normal ev havuzunda reddedilir (%70 LTV)", async () => {
    await expectError(apply(N, 0, price, down), "InsufficientDownPayment");
  });

  it("2008 modunda %97 LTV kredi, ilk zarar kasası 0 iken fonlanır", async () => {
    await apply(C, 0, price, down);
    const inst = m.installment(principal, 700, 240);
    assert.equal(await bal(escrowOf(loanOf(C, 0))), down + m.originationFee(principal));
    assert.equal(await bal(collateralOf(loanOf(C, 0))), m.collateralAmount(inst));
    await approve(C, 0, price);
    await fund(C, 0);
    const p = await program.account.pool.fetch(C.pool);
    assert.equal(p.totalOutstanding.toString(), principal.toString());
    assert.equal(p.firstLossBalance.toString(), "0");
  });

  it("2008 modunda da LTV, min(fiyat, ekspertiz) üzerinden korunur (AppraisalTooLow)", async () => {
    // 2008 modunda bile LTV sınırı min(fiyat, ekspertiz) üzerindendir: ekspertiz 90k → izin 87,3k < 97k.
    await apply(C, 1, price, down);
    await expectError(approve(C, 1, 90_000n * USDC), "AppraisalTooLow");
  });

  it("ikinci 2008 kredisi: ilk zarar 0 ve yedek fon freni 0 iken de fonlanır", async () => {
    await approve(C, 1, price);
    await fund(C, 1);
    const p = await program.account.pool.fetch(C.pool);
    assert.equal(p.totalOutstanding.toString(), (2n * principal).toString());
    assert.equal(p.firstLossBalance.toString(), "0");
  });

  it("aynı koşullar normal havuzda ilk zarar kuralına takılır (%5)", async () => {
    // normal havuzda %30 peşinatlı kredi, ilk zarar kasası boş: InsufficientFirstLoss
    await apply(N, 0, price, 30_000n * USDC);
    await approve(N, 0, price);
    await expectError(fund(N, 0), "InsufficientFirstLoss");
  });
});
