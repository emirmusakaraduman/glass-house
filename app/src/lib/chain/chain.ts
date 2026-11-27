import { AnchorError, AnchorProvider, BN, BorshInstructionCoder, Program } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AccountMeta,
} from "@solana/web3.js";
import idlJson from "../../../public/idl/glasshouse.json";
import { POOLS } from "../pools";
import type { InvestorPosition, Loan, PoolId, PoolState, SharePricePoint, TxResult, WithdrawRequest } from "../types";
import { fromMicro, mapStatus, pdas, toMicro } from "./anchor";
import { ApplyLoanArgs, ClientError, CosignRequest, GlassHouseClient, computeMetrics, loanKey, parseLoanKey } from "./client";
import type { Glasshouse } from "./idl/glasshouse";

// GlassHouseClient backed by the deployed program (NEXT_PUBLIC_DATA_SOURCE=chain).
// The IDL is public/idl/glasshouse.json, synced from deployments/idl by `npm run idl:sync`.
// Screens talk to the same interface as the mock, so they don't change.

/** City-level region codes written by approve_loan. 0 = not disclosed. */
const REGIONS: Record<number, string> = { 1: "Panama City", 2: "Guayaquil" };
const regionCode = (city: string) => Number(Object.entries(REGIONS).find(([, v]) => v === city)?.[0] ?? 0);

const LIVE = ["Active", "Late1", "Late2"];
const SNAPSHOT_TTL_MS = 2000;
/** process_withdrawals pays at most this many requests per transaction. */
const MAX_WITHDRAWALS_PER_TX = 3;
const ERR_PERIOD_ALREADY_PROCESSED = 6016;

type RawPool = Awaited<ReturnType<Program<Glasshouse>["account"]["pool"]["fetch"]>>;
type RawLoan = Awaited<ReturnType<Program<Glasshouse>["account"]["loan"]["fetch"]>>;

interface Snapshot {
  pools: Map<PoolId, { pk: PublicKey; raw: RawPool; state: PoolState }>;
  loans: Loan[];
  /** Loan key → on-chain address and raw account, for writes. */
  loanRefs: Map<string, { pk: PublicKey; raw: RawLoan; poolPk: PublicKey }>;
}

/** Off-chain notes the borrower's browser keeps (never on chain): city and listing hash. */
interface LocalLoanNote {
  region: string;
  assetRefHash: string | null;
}

export class ChainClient implements GlassHouseClient {
  readonly mode = "chain" as const;
  readonly actor: string;
  /** In-browser seller wallet for demos: it co-signs apply_loan from this tab. */
  readonly demoSeller: string;

  private program: Program<Glasshouse>;
  private seller: Keypair;
  private listeners = new Set<() => void>();
  private cache: { at: number; p: Promise<Snapshot> } | null = null;
  private pda: ReturnType<typeof pdas>;

  constructor(
    private connection: Connection,
    private wallet: AnchorWallet | null,
  ) {
    // Read-only provider when no wallet is connected: reads work, writes ask for a wallet.
    const readonlyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async () => {
        throw new ClientError("Connect a wallet to sign this transaction.");
      },
      signAllTransactions: async () => {
        throw new ClientError("Connect a wallet to sign this transaction.");
      },
    } as unknown as AnchorWallet;
    const provider = new AnchorProvider(connection, wallet ?? readonlyWallet, { commitment: "confirmed" });
    this.program = new Program<Glasshouse>(idlJson as Glasshouse, provider);
    this.pda = pdas(this.program.programId);
    this.actor = wallet?.publicKey.toBase58() ?? "";
    this.seller = loadDemoSeller();
    this.demoSeller = this.seller.publicKey.toBase58();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed() {
    this.cache = null;
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- reads

  async getPools() {
    const s = await this.snapshot();
    return [...s.pools.values()].map((p) => p.state);
  }

  async getPool(id: PoolId) {
    return (await this.snapshot()).pools.get(id)?.state ?? null;
  }

  async getLoans(filter: { poolId?: PoolId; borrower?: string } = {}) {
    const s = await this.snapshot();
    return s.loans.filter((l) => (!filter.poolId || l.poolId === filter.poolId) && (!filter.borrower || l.borrower === filter.borrower));
  }

  async getLoan(key: string) {
    return (await this.snapshot()).loans.find((l) => l.key === key) ?? null;
  }

  /**
   * The program keeps no price history, so this browser records a point whenever the price
   * changes. The chart starts from the first visit; an indexer can replace this later.
   */
  async getSharePriceHistory(poolId: PoolId): Promise<SharePricePoint[]> {
    const s = await this.snapshot();
    const pool = s.pools.get(poolId);
    const storeKey = `gh.priceHistory.${this.program.programId.toBase58()}.${poolId}`;
    const hist: SharePricePoint[] = readJson(storeKey) ?? [];
    if (pool) {
      const price = computeMetrics(pool.state, s.loans).sharePrice;
      const last = hist.at(-1);
      if (!last || Math.abs(last.price - price) > 1e-9) {
        hist.push({ at: Date.now(), price });
        writeJson(storeKey, hist.slice(-500));
      }
    }
    return hist;
  }

  async getPosition(poolId: PoolId, owner: string): Promise<InvestorPosition> {
    const s = await this.snapshot();
    const pool = s.pools.get(poolId);
    if (!pool || !owner) return { owner, shares: 0, lockedShares: 0, value: 0 };
    const ownerPk = new PublicKey(owner);
    const shares = await this.tokenBalance(getAssociatedTokenAddressSync(this.pda.shareMint(pool.pk), ownerPk, true));
    const locked = pool.state.withdrawQueue.filter((w) => w.owner === owner).reduce((a, w) => a + w.shares, 0);
    const price = computeMetrics(pool.state, s.loans).sharePrice;
    return { owner, shares, lockedShares: locked, value: shares * price };
  }

  async getWalletBalance(owner: string) {
    if (!owner) return 0;
    const mint = await this.usdcMint();
    if (!mint) return 0;
    return this.tokenBalance(getAssociatedTokenAddressSync(mint, new PublicKey(owner), true));
  }

  // ---------------------------------------------------------------- investor

  async deposit(poolId: PoolId, amount: number) {
    if (!(amount > 0)) throw new ClientError("Enter an amount above zero.");
    const me = this.me();
    const { pk: pool, raw } = await this.pool(poolId);
    const shareMint = this.pda.shareMint(pool);
    const depositorShares = getAssociatedTokenAddressSync(shareMint, me, true);
    return this.send(
      this.program.methods
        .deposit(bn(toMicro(amount)))
        .accountsPartial({
          depositor: me,
          pool,
          depositorUsdc: getAssociatedTokenAddressSync(raw.usdcMint, me, true),
          vault: this.pda.vault(pool),
          shareMint,
          depositorShares,
        })
        .preInstructions([createAssociatedTokenAccountIdempotentInstruction(me, depositorShares, me, shareMint)]),
    );
  }

  async requestWithdraw(poolId: PoolId, shares: number) {
    if (!(shares > 0)) throw new ClientError("Enter a share amount above zero.");
    const me = this.me();
    const { pk: pool, raw } = await this.pool(poolId);
    const shareMint = this.pda.shareMint(pool);
    const destination = getAssociatedTokenAddressSync(raw.usdcMint, me, true);
    return this.send(
      this.program.methods
        .requestWithdraw(bn(toMicro(shares)))
        .accountsPartial({
          owner: me,
          pool,
          shareMint,
          ownerShares: getAssociatedTokenAddressSync(shareMint, me, true),
          destination,
          shareEscrow: this.pda.shareEscrow(pool),
          withdrawRequest: this.pda.withdrawRequest(pool, BigInt(raw.withdrawTail.toString())),
        })
        .preInstructions([createAssociatedTokenAccountIdempotentInstruction(me, destination, me, raw.usdcMint)]),
    );
  }

  async processWithdrawals(poolId: PoolId) {
    const me = this.me();
    const { pk: pool, raw } = await this.pool(poolId);
    const head = BigInt(raw.withdrawHead.toString());
    const tail = BigInt(raw.withdrawTail.toString());
    // Before the first request share_escrow doesn't exist and the program fails on the account
    // check, so an empty queue is answered here instead of with a failed transaction.
    if (!(head < tail)) throw new ClientError("No withdrawal requests in the queue.");

    const remaining: AccountMeta[] = [];
    for (let seq = head; seq < tail && remaining.length < MAX_WITHDRAWALS_PER_TX * 3; seq++) {
      const reqPk = this.pda.withdrawRequest(pool, seq);
      const req = await this.program.account.withdrawRequest.fetchNullable(reqPk);
      if (!req) continue;
      remaining.push(
        { pubkey: reqPk, isSigner: false, isWritable: true },
        { pubkey: req.destination, isSigner: false, isWritable: true },
        { pubkey: req.owner, isSigner: false, isWritable: true },
      );
    }
    if (remaining.length === 0) throw new ClientError("No withdrawal requests in the queue.");
    return this.send(
      this.program.methods
        .processWithdrawals()
        .accountsPartial({
          cranker: me,
          pool,
          vault: this.pda.vault(pool),
          shareMint: this.pda.shareMint(pool),
          shareEscrow: this.pda.shareEscrow(pool),
        })
        .remainingAccounts(remaining),
    );
  }

  // ---------------------------------------------------------------- borrower flow

  async applyLoan(args: ApplyLoanArgs) {
    const me = this.me();
    if (!args.seller) throw new ClientError("The seller has to co-sign the application.");
    if (args.seller === this.actor) throw new ClientError("The seller must use a different wallet from the borrower.");
    // apply_loan needs both signatures. Here this tab signs for its demo seller wallet; a
    // seller on another device goes through prepareApplyLoan → co-sign link instead.
    if (args.seller !== this.demoSeller) {
      throw new ClientError("A seller on another device signs through a co-sign link.");
    }
    const { builder, loan, key } = await this.applyBuilder(args, me);
    const sig = await this.send(builder.signers([this.seller]));
    // City and listing hash stay in this browser until the underwriter approves.
    writeJson(noteKey(loan), { region: args.region, assetRefHash: args.assetRefHash } satisfies LocalLoanNote);
    return { ...sig, loanKey: key };
  }

  private async applyBuilder(args: ApplyLoanArgs, me: PublicKey) {
    const { pk: pool, raw } = await this.pool(args.poolId);
    const id = BigInt(raw.nextLoanId.toString());
    const loan = this.pda.loan(pool, id);
    const builder = this.program.methods
      .applyLoan(bn(toMicro(args.price)), bn(toMicro(args.downPayment)))
      .accountsPartial({
        borrower: me,
        seller: new PublicKey(args.seller),
        pool,
        loan,
        usdcMint: raw.usdcMint,
        borrowerUsdc: getAssociatedTokenAddressSync(raw.usdcMint, me, true),
        loanEscrow: this.pda.loanEscrow(loan),
        collateralEscrow: this.pda.collateral(loan),
      });
    return { builder, loan, key: loanKey(args.poolId, Number(id)) };
  }

  // ---------------------------------------------------------------- co-sign link

  /**
   * Borrower side. Builds apply_loan on the borrower's durable nonce (so the link doesn't
   * expire after ~1 minute like a normal blockhash), signs it as fee payer and returns the
   * partly signed transaction for the seller.
   */
  async prepareApplyLoan(args: ApplyLoanArgs) {
    const me = this.me();
    if (!args.seller) throw new ClientError("Add the seller's wallet address.");
    if (args.seller === this.actor) throw new ClientError("The seller must use a different wallet from the borrower.");
    let sellerPk: PublicKey;
    try {
      sellerPk = new PublicKey(args.seller);
    } catch {
      throw new ClientError("That seller address isn't a valid Solana address.");
    }
    if (!PublicKey.isOnCurve(sellerPk.toBytes())) throw new ClientError("The seller address has to be a wallet, not a program account.");

    const nonceAccount = await this.ensureNonce(me);
    const { builder, loan, key } = await this.applyBuilder(args, me);
    const applyIx = await builder.instruction();
    const message = new TransactionMessage({
      payerKey: me,
      recentBlockhash: nonceAccount.nonce,
      instructions: [SystemProgram.nonceAdvance({ noncePubkey: nonceAccount.address, authorizedPubkey: me }), applyIx],
    }).compileToLegacyMessage();
    const signed = await this.signWithWallet(new VersionedTransaction(message));
    writeJson(noteKey(loan), { region: args.region, assetRefHash: args.assetRefHash } satisfies LocalLoanNote);
    return { payload: toBase64Url(signed.serialize()), loanKey: key };
  }

  /** Borrower side: advancing the nonce makes every link signed so far unusable. */
  async cancelCosignLinks() {
    const me = this.me();
    const noncePk = await nonceAddress(me);
    if (!(await this.connection.getAccountInfo(noncePk))) throw new ClientError("There is no open co-sign link to cancel.");
    try {
      const tx = new Transaction().add(SystemProgram.nonceAdvance({ noncePubkey: noncePk, authorizedPubkey: me }));
      const signature = await this.program.provider.sendAndConfirm!(tx);
      this.changed();
      return { signature, mock: false };
    } catch (e) {
      throw toChainError(e);
    }
  }

  /**
   * Seller side, before signing. The link comes from outside, so everything the seller's
   * wallet would sign is checked here: exactly [nonce advance, apply_loan], the borrower pays
   * the fees, and the seller signs nothing else.
   */
  async describeCosign(payload: string): Promise<CosignRequest> {
    const tx = decodeCosign(payload);
    const msg = tx.message;
    const keys = msg.staticAccountKeys;
    const ixs = msg.compiledInstructions;
    const bad = (why: string) => new ClientError(`This link can't be signed: ${why}`);
    if (ixs.length !== 2) throw bad("it contains other instructions.");
    const [advance, apply] = ixs;

    const feePayer = keys[0];
    const advanceData = Buffer.from(advance.data);
    if (!keys[advance.programIdIndex].equals(SystemProgram.programId) || advanceData.length < 4 || advanceData.readUInt32LE(0) !== 4) {
      throw bad("it doesn't start with the borrower's nonce.");
    }
    const nonceAddr = keys[advance.accountKeyIndexes[0]];
    if (!keys[advance.accountKeyIndexes[2]].equals(feePayer)) throw bad("the nonce isn't the borrower's.");

    if (!keys[apply.programIdIndex].equals(this.program.programId)) throw bad("it isn't for the GlassHouse program.");
    const decoded = new BorshInstructionCoder(this.program.idl).decode(Buffer.from(apply.data));
    if (!decoded || !/^apply_?loan$/i.test(decoded.name)) throw bad("it isn't a loan application.");
    const data = decoded.data as Record<string, BN>;
    const acc = (i: number) => keys[apply.accountKeyIndexes[i]];
    const borrower = acc(0);
    const seller = acc(1);
    const poolPk = acc(2);
    const loanPk = acc(3);
    if (!borrower.equals(feePayer)) throw bad("the borrower doesn't pay the fees.");
    if (seller.equals(feePayer)) throw bad("the seller would pay the fees.");
    // The seller must be a signer only of apply_loan, never of the nonce or as fee payer.
    const signerKeys = keys.slice(0, msg.header.numRequiredSignatures);
    if (signerKeys.length !== 2 || !signerKeys.some((k) => k.equals(seller))) throw bad("the signers aren't the borrower and the seller.");
    if (tx.signatures[0].every((b) => b === 0)) throw bad("the borrower hasn't signed it.");

    const s = await this.snapshot();
    const pool = [...s.pools.entries()].find(([, p]) => p.pk.equals(poolPk));
    if (!pool) throw bad("the pool isn't on this network.");
    const [poolId, poolEntry] = pool;
    const nextId = BigInt(poolEntry.raw.nextLoanId.toString());

    let problem: string | null = null;
    const nonceInfo = await this.connection.getAccountInfo(nonceAddr);
    if (await this.connection.getAccountInfo(loanPk)) problem = "This application was already sent.";
    else if (!nonceInfo || NonceAccount.fromAccountData(nonceInfo.data).nonce !== msg.recentBlockhash) problem = "The borrower cancelled this link or made a newer one. Ask for a new link.";
    else if (!this.pda.loan(poolPk, nextId).equals(loanPk)) problem = "Another application was sent first, so this link is out of date. Ask the borrower for a new link.";

    const price = data.price ?? (data as Record<string, BN>)["price"];
    const down = data.down_payment ?? (data as Record<string, BN>)["downPayment"];
    return {
      poolId,
      loanKey: loanKey(poolId, Number(nextId)),
      price: fromMicro(price),
      downPayment: fromMicro(down),
      borrower: borrower.toBase58(),
      seller: seller.toBase58(),
      problem,
    };
  }

  /** Seller side: sign with the connected wallet and send. */
  async cosignApplyLoan(payload: string) {
    const me = this.me();
    const req = await this.describeCosign(payload);
    if (req.problem) throw new ClientError(req.problem);
    if (req.seller !== me.toBase58()) throw new ClientError(`This link is for the seller wallet ${req.seller.slice(0, 4)}…${req.seller.slice(-4)}. Connect that wallet.`);
    try {
      const signed = await this.signWithWallet(decodeCosign(payload));
      const signature = await this.connection.sendRawTransaction(signed.serialize());
      await this.waitFor(signature);
      this.changed();
      return { signature, mock: false, loanKey: req.loanKey };
    } catch (e) {
      throw toChainError(e);
    }
  }

  private async signWithWallet(tx: VersionedTransaction) {
    if (!this.wallet) throw new ClientError("Connect a wallet to sign this transaction.");
    try {
      return await this.wallet.signTransaction(tx);
    } catch (e) {
      throw toChainError(e);
    }
  }

  /** The borrower's nonce account (address derived from the wallet), created on first use. */
  private async ensureNonce(me: PublicKey) {
    const address = await nonceAddress(me);
    let info = await this.connection.getAccountInfo(address);
    if (!info) {
      const lamports = await this.connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
      const tx = new Transaction().add(
        SystemProgram.createAccountWithSeed({
          fromPubkey: me,
          newAccountPubkey: address,
          basePubkey: me,
          seed: NONCE_SEED,
          lamports,
          space: NONCE_ACCOUNT_LENGTH,
          programId: SystemProgram.programId,
        }),
        SystemProgram.nonceInitialize({ noncePubkey: address, authorizedPubkey: me }),
      );
      try {
        await this.program.provider.sendAndConfirm!(tx);
      } catch (e) {
        throw toChainError(e);
      }
      info = await this.connection.getAccountInfo(address);
      if (!info) throw new ClientError("Couldn't set up the co-sign link. Try again.");
    }
    return { address, nonce: NonceAccount.fromAccountData(info.data).nonce };
  }

  /** Nonce transactions have no blockhash expiry, so confirmation is a plain status poll. */
  private async waitFor(signature: string) {
    for (let i = 0; i < 60; i++) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const st = value[0];
      if (st?.err) throw new ClientError(`The transaction failed: ${JSON.stringify(st.err)}`);
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new ClientError("Sent, but not confirmed after a minute. Check Explorer before trying again.");
  }

  async approveLoan(key: string, appraisal: number, docHash: string) {
    return this.decide(key, true, appraisal, docHash);
  }

  async rejectLoan(key: string) {
    return this.decide(key, false, 0, null);
  }

  private async decide(key: string, approve: boolean, appraisal: number, docHash: string | null) {
    const me = this.me();
    const { pk: loan, raw, poolPk: pool } = await this.loanRef(key);
    const note = readJson<LocalLoanNote>(noteKey(loan));
    const usdc = (await this.poolByPk(pool)).raw.usdcMint;
    return this.send(
      this.program.methods
        .approveLoan(
          approve ? { approve: {} } : { reject: {} },
          bn(toMicro(appraisal)),
          hexToBytes32(docHash),
          hexToBytes32(note?.assetRefHash ?? null),
          note ? regionCode(note.region) : 0,
          approve,
          approve,
        )
        .accountsPartial({
          underwriter: me,
          pool,
          loan,
          borrower: raw.borrower,
          borrowerUsdc: getAssociatedTokenAddressSync(usdc, raw.borrower, true),
          loanEscrow: this.pda.loanEscrow(loan),
          collateralEscrow: this.pda.collateral(loan),
        }),
    );
  }

  async fundLoan(key: string) {
    const me = this.me();
    const { pk: loan, poolPk: pool } = await this.loanRef(key);
    return this.send(
      this.program.methods.fundLoan().accountsPartial({
        caller: me,
        pool,
        loan,
        vault: this.pda.vault(pool),
        loanEscrow: this.pda.loanEscrow(loan),
      }),
    );
  }

  async confirmTitle(key: string) {
    const me = this.me();
    const { pk: loan, raw, poolPk: pool } = await this.loanRef(key);
    const p = (await this.poolByPk(pool)).raw;
    const sellerUsdc = getAssociatedTokenAddressSync(p.usdcMint, raw.seller, true);
    return this.send(
      this.program.methods
        .confirmTitle()
        .accountsPartial({
          titleAgent: me,
          pool,
          loan,
          loanEscrow: this.pda.loanEscrow(loan),
          sellerUsdc,
          reserveVault: this.pda.reserve(pool),
          platformTreasury: p.platformTreasury,
        })
        .preInstructions([createAssociatedTokenAccountIdempotentInstruction(me, sellerUsdc, raw.seller, p.usdcMint)]),
    );
  }

  async repay(key: string) {
    const me = this.me();
    const { pk: loan, raw, poolPk: pool } = await this.loanRef(key);
    if (!LIVE.includes(mapStatus(raw.status as Record<string, unknown>))) throw new ClientError("This loan isn't taking payments.");
    const p = (await this.poolByPk(pool)).raw;
    return this.send(
      this.program.methods
        .repay(bn(installmentDue(raw)))
        .accountsPartial({
          payer: me,
          pool,
          loan,
          payerUsdc: getAssociatedTokenAddressSync(p.usdcMint, me, true),
          vault: this.pda.vault(pool),
          reserve: this.pda.reserve(pool),
          platformTreasury: p.platformTreasury,
        }),
    );
  }

  async crankLoan(key: string) {
    const me = this.me();
    const { pk: loan, poolPk: pool } = await this.loanRef(key);
    const p = (await this.poolByPk(pool)).raw;
    try {
      const sig = await this.send(
        this.program.methods.crankLoan().accountsPartial({
          cranker: me,
          pool,
          loan,
          collateral: this.pda.collateral(loan),
          vault: this.pda.vault(pool),
          reserve: this.pda.reserve(pool),
          platformTreasury: p.platformTreasury,
        }),
      );
      const after = await this.getLoan(key);
      return { ...sig, changed: true, message: after ? `Loan is now ${after.status}.` : "Loan updated." };
    } catch (e) {
      // 6016 means this period was already handled: not a failure, just nothing to do.
      if (e instanceof ChainError && e.code === ERR_PERIOD_ALREADY_PROCESSED) {
        return { signature: "", mock: false, changed: false, message: "No period to process. Nothing changed." };
      }
      throw e;
    }
  }

  async recordRecovery(key: string, proceeds: number) {
    const me = this.me();
    const { pk: loan, poolPk: pool } = await this.loanRef(key);
    const p = (await this.poolByPk(pool)).raw;
    return this.send(
      this.program.methods.recordRecovery(bn(toMicro(proceeds))).accountsPartial({
        recoveryAgent: me,
        coSigner: null,
        pool,
        loan,
        recoverySource: getAssociatedTokenAddressSync(p.usdcMint, me, true),
        vault: this.pda.vault(pool),
        collateral: this.pda.collateral(loan),
        firstLoss: this.pda.firstLoss(pool),
        reserve: this.pda.reserve(pool),
      }),
    );
  }

  // ---------------------------------------------------------------- internals

  private me(): PublicKey {
    if (!this.wallet) throw new ClientError("Connect a wallet to sign this transaction.");
    return this.wallet.publicKey;
  }

  private async send(builder: { rpc(): Promise<string> }): Promise<TxResult> {
    try {
      const signature = await builder.rpc();
      this.changed();
      return { signature, mock: false };
    } catch (e) {
      throw toChainError(e);
    }
  }

  private snapshot(): Promise<Snapshot> {
    if (this.cache && Date.now() - this.cache.at < SNAPSHOT_TTL_MS) return this.cache.p;
    const p = this.load();
    this.cache = { at: Date.now(), p };
    p.catch(() => (this.cache = null));
    return p;
  }

  private async load(): Promise<Snapshot> {
    const [poolAccs, loanAccs, reqAccs] = await Promise.all([
      this.program.account.pool.all(),
      this.program.account.loan.all(),
      this.program.account.withdrawRequest.all(),
    ]);

    // One pool per asset type: an env override, else the lowest pool_id (the 2008-mode pool
    // is a later id of the same type).
    const pools = new Map<PoolId, { pk: PublicKey; raw: RawPool; state: PoolState }>();
    const byPk = new Map<string, PoolId>();
    for (const id of ["house", "vehicle"] as PoolId[]) {
      const override = id === "house" ? process.env.NEXT_PUBLIC_HOUSE_POOL : process.env.NEXT_PUBLIC_VEHICLE_POOL;
      const candidates = poolAccs
        .filter((a) => (override ? a.publicKey.toBase58() === override : assetTypeOf(a.account) === id))
        .sort((a, b) => a.account.poolId.cmp(b.account.poolId));
      const pick = candidates[0];
      if (!pick) continue;
      byPk.set(pick.publicKey.toBase58(), id);
      pools.set(id, { pk: pick.publicKey, raw: pick.account, state: null as unknown as PoolState });
    }

    const ours = loanAccs.filter((a) => byPk.has(a.account.pool.toBase58()));
    const collateralPks = ours.map((a) => this.pda.collateral(a.publicKey));
    const collateralInfos = collateralPks.length ? await this.connection.getMultipleAccountsInfo(collateralPks) : [];

    const loans: Loan[] = [];
    const loanRefs = new Map<string, { pk: PublicKey; raw: RawLoan; poolPk: PublicKey }>();
    ours.forEach((a, i) => {
      const poolId = byPk.get(a.account.pool.toBase58())!;
      const info = collateralInfos[i];
      const collateral = info ? fromMicro(unpackAccount(collateralPks[i], info).amount) : 0;
      const loan = toLoan(poolId, a.publicKey, a.account, collateral);
      loans.push(loan);
      loanRefs.set(loan.key, { pk: a.publicKey, raw: a.account, poolPk: a.account.pool });
    });
    loans.sort((a, b) => (a.poolId === b.poolId ? a.seq - b.seq : a.poolId.localeCompare(b.poolId)));

    for (const [id, entry] of pools) {
      const queue: WithdrawRequest[] = reqAccs
        .filter((r) => r.account.pool.equals(entry.pk))
        .map((r) => ({
          seq: Number(r.account.seq.toString()),
          owner: r.account.owner.toBase58(),
          shares: fromMicro(r.account.shares),
          requestedAt: Number(r.account.createdAt.toString()) * 1000,
        }))
        .sort((a, b) => a.seq - b.seq);
      entry.state = toPoolState(id, entry.raw, loans, queue);
    }
    return { pools, loans, loanRefs };
  }

  private async pool(id: PoolId) {
    const p = (await this.snapshot()).pools.get(id);
    if (!p) throw new ClientError(`The ${id} pool isn't on this network yet.`);
    // Writes need fresh counters (next_loan_id, withdraw_tail), not the cached ones.
    return { pk: p.pk, raw: await this.program.account.pool.fetch(p.pk) };
  }

  private async poolByPk(pk: PublicKey) {
    return { pk, raw: await this.program.account.pool.fetch(pk) };
  }

  private async loanRef(key: string) {
    if (!parseLoanKey(key)) throw new ClientError(`Loan ${key} not found.`);
    const ref = (await this.snapshot()).loanRefs.get(key);
    if (!ref) throw new ClientError(`Loan ${key} not found.`);
    return { ...ref, raw: await this.program.account.loan.fetch(ref.pk) };
  }

  private async usdcMint(): Promise<PublicKey | null> {
    const env = process.env.NEXT_PUBLIC_USDC_MINT;
    if (env) return new PublicKey(env);
    const first = [...(await this.snapshot()).pools.values()][0];
    return first?.raw.usdcMint ?? null;
  }

  private async tokenBalance(ata: PublicKey) {
    const info = await this.connection.getAccountInfo(ata);
    return info ? fromMicro(unpackAccount(ata, info).amount) : 0;
  }
}

// ---------------------------------------------------------------- mapping

function assetTypeOf(raw: RawPool): PoolId {
  return "vehicle" in (raw.assetType as object) ? "vehicle" : "house";
}

function toPoolState(id: PoolId, raw: RawPool, loans: Loan[], queue: WithdrawRequest[]): PoolState {
  const bps = (v: number) => v / 10_000;
  const base = POOLS[id];
  return {
    params: {
      ...base,
      maxLtv: bps(raw.maxLtvBps),
      annualRate: bps(raw.rateBps),
      termMonths: raw.termMonths,
      recoveryCoeff: bps(raw.recoveryCoeffBps),
      provisionRates: raw.provisionBps.map(bps) as [number, number, number, number],
      liquidityBuffer: bps(raw.bufferBps),
      brakeDelinquency: bps(raw.brakeLateBps),
      brakeReserveMin: bps(raw.brakeReserveBps),
      firstLossTarget: bps(raw.minFirstLossBps),
      periodSeconds: Number(raw.periodSeconds.toString()),
      graceSeconds: Number(raw.graceSeconds.toString()),
    },
    idleCash: fromMicro(raw.idleCash),
    outstandingPrincipal: fromMicro(raw.totalOutstanding),
    lossProvision: fromMicro(raw.lossProvision),
    firstLossVault: fromMicro(raw.firstLossBalance),
    reserve: fromMicro(raw.reserveBalance),
    // Fees go straight to platform_treasury; the program keeps no running total.
    platformFees: 0,
    totalShares: fromMicro(raw.totalShares),
    escrowed: loans.filter((l) => l.poolId === id && l.status === "Funded").reduce((a, l) => a + l.principal, 0),
    nextLoanSeq: Number(raw.nextLoanId.toString()),
    withdrawQueue: queue,
  };
}

function toLoan(poolId: PoolId, pk: PublicKey, raw: RawLoan, collateral: number): Loan {
  const status = mapStatus(raw.status as Record<string, unknown>);
  const price = fromMicro(raw.price);
  const principal = fromMicro(raw.principal);
  const appraised = fromMicro(raw.appraisedValue);
  const nextDue = Number(raw.nextDue.toString());
  const note = readJson<LocalLoanNote>(noteKey(pk));
  const docHash = bytesToHex(raw.docHash);
  const assetRefHash = bytesToHex(raw.assetRefHash);
  const fundedAt = Number(raw.fundedAt.toString()) * 1000;
  return {
    key: loanKey(poolId, Number(raw.id.toString())),
    poolId,
    seq: Number(raw.id.toString()),
    status,
    price,
    appraisal: appraised > 0 ? appraised : null,
    downPayment: Math.max(0, price - principal),
    principal,
    remainingPrincipal: fromMicro(raw.remainingPrincipal),
    annualRate: raw.rateBps / 10_000,
    termMonths: POOLS[poolId].termMonths,
    installment: fromMicro(raw.installment),
    paidInstallments: raw.paidInstallments,
    missedInstallments: raw.missedInstallments,
    nextDueAt: nextDue > 0 && LIVE.includes(status) ? nextDue * 1000 : null,
    lateFeeDue: fromMicro(raw.lateFeeAccrued),
    collateral,
    originationFee: principal * POOLS[poolId].originationFee,
    provision: fromMicro(raw.provisionAmount),
    accruedInterest: 0,
    region: REGIONS[raw.regionCode] ?? note?.region ?? "Not disclosed",
    borrower: raw.borrower.toBase58(),
    seller: raw.seller.toBase58(),
    docHash,
    assetRefHash: assetRefHash ?? note?.assetRefHash ?? null,
    createdAt: fundedAt || 0,
    // Loan history needs a transaction indexer; the chain view shows the current state only.
    events: [],
  };
}

/**
 * What repay accepts for one installment, in micro-USDC, matching the program:
 * late fee + min(installment, remaining + this period's interest). Interest rounds up.
 */
function installmentDue(raw: RawLoan): bigint {
  const SCALE = 10n ** 18n;
  const remaining = BigInt(raw.remainingPrincipal.toString());
  const monthly = (BigInt(raw.rateBps) * SCALE) / 120_000n;
  const interest = (remaining * monthly + SCALE - 1n) / SCALE;
  const installment = BigInt(raw.installment.toString());
  const final = remaining + interest;
  return BigInt(raw.lateFeeAccrued.toString()) + (installment < final ? installment : final);
}

// ---------------------------------------------------------------- errors

export class ChainError extends ClientError {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

function toChainError(e: unknown): Error {
  if (e instanceof ClientError) return e;
  const anchorErr = e instanceof AnchorError ? e : AnchorError.parse((e as { logs?: string[] })?.logs ?? []);
  if (anchorErr) {
    const { number, errorMessage } = anchorErr.error.errorCode ? { number: anchorErr.error.errorCode.number, errorMessage: anchorErr.error.errorMessage } : { number: null, errorMessage: anchorErr.message };
    return new ChainError(`${errorMessage}${number ? ` (${number})` : ""}`, number);
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|rejected the request/i.test(msg)) return new ClientError("You cancelled the request in your wallet.");
  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(msg);
  if (custom) {
    const code = parseInt(custom[1], 16);
    const known = (idlJson as { errors?: { code: number; msg?: string; name: string }[] }).errors?.find((x) => x.code === code);
    return new ChainError(`${known?.msg ?? known?.name ?? "Program error"} (${code})`, code);
  }
  return new ClientError(msg);
}

// ---------------------------------------------------------------- co-sign link encoding

const NONCE_SEED = "glasshouse-cosign";

function nonceAddress(owner: PublicKey) {
  return PublicKey.createWithSeed(owner, NONCE_SEED, SystemProgram.programId);
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCosign(payload: string): VersionedTransaction {
  try {
    const b64 = payload.trim().replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return VersionedTransaction.deserialize(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    throw new ClientError("This link is damaged. Ask the borrower to send it again.");
  }
}

// ---------------------------------------------------------------- small helpers

function bn(v: bigint) {
  return new BN(v.toString());
}

function hexToBytes32(hex: string | null): number[] {
  const out = new Array<number>(32).fill(0);
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) return out;
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: number[]): string | null {
  if (bytes.every((b) => b === 0)) return null;
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function noteKey(loan: PublicKey) {
  return `gh.loanNote.${loan.toBase58()}`;
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the app still works, it only forgets local notes.
  }
}

/** Demo seller kept in this browser so one person can rehearse the two-signature apply. */
function loadDemoSeller(): Keypair {
  const key = "gh.demoSellerSecret";
  const saved = readJson<number[]>(key);
  if (saved?.length === 64) return Keypair.fromSecretKey(Uint8Array.from(saved));
  const kp = Keypair.generate();
  writeJson(key, Array.from(kp.secretKey));
  return kp;
}
