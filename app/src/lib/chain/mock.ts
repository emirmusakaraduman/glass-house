import { monthlyPayment, round2 } from "../finance";
import { POOLS } from "../pools";
import type { InvestorPosition, Loan, LoanEvent, PoolId, PoolState, TxResult } from "../types";
import { ApplyLoanArgs, ClientError, GlassHouseClient, computeMetrics, loanKey } from "./client";
import { DEMO_WALLET, MOCK_STARTING_BALANCE, MockState, buildMockState } from "./mock-seed";

// In-memory implementation of GlassHouseClient that follows the program rules from the v4 doc
// closely enough to build and rehearse every screen before the IDL exists.
// Simplifications are marked "mock:". State lives in memory and resets on reload.

let counter = 0;
const mockSig = (): TxResult => ({ signature: `mock-${Date.now().toString(36)}-${(counter++).toString(36)}`, mock: true });

export class MockClient implements GlassHouseClient {
  readonly mode = "mock" as const;
  actor: string = DEMO_WALLET;
  private state: MockState = buildMockState();
  private listeners = new Set<() => void>();

  setActor(wallet: string | null) {
    this.actor = wallet ?? DEMO_WALLET;
    this.emit();
  }

  reset() {
    this.state = buildMockState();
    this.emit();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- reads

  async getPools() {
    this.tick();
    return (["house", "vehicle"] as PoolId[]).map((id) => this.clonePool(id));
  }

  async getPool(id: PoolId) {
    this.tick();
    return this.clonePool(id);
  }

  async getLoans(filter: { poolId?: PoolId; borrower?: string } = {}) {
    this.tick();
    return [...this.state.loans.values()]
      .filter((l) => (!filter.poolId || l.poolId === filter.poolId) && (!filter.borrower || l.borrower === filter.borrower))
      .map(cloneLoan);
  }

  async getLoan(key: string) {
    this.tick();
    const l = this.state.loans.get(key);
    return l ? cloneLoan(l) : null;
  }

  async getSharePriceHistory(poolId: PoolId) {
    this.tick();
    return this.state.history[poolId].map((p) => ({ ...p }));
  }

  async getPosition(poolId: PoolId, owner: string): Promise<InvestorPosition> {
    const pos = this.state.positions[poolId].get(owner) ?? { shares: 0, locked: 0 };
    const price = this.sharePrice(poolId);
    return { owner, shares: pos.shares, lockedShares: pos.locked, value: pos.shares * price };
  }

  async getWalletBalance(owner: string) {
    return round2(this.wallet(owner));
  }

  // ---------------------------------------------------------------- investor

  async deposit(poolId: PoolId, amount: number) {
    if (!(amount > 0)) throw new ClientError("Enter an amount above zero.");
    this.debit(this.actor, amount, "this deposit");
    const pool = this.state.pools[poolId];
    // mock: no virtual share offset; the program adds one against the first-depositor attack.
    const shares = amount / this.sharePrice(poolId);
    pool.idleCash += amount;
    pool.totalShares += shares;
    const pos = this.position(poolId, this.actor);
    pos.shares += shares;
    this.recordPrice(poolId);
    this.emit();
    return mockSig();
  }

  async requestWithdraw(poolId: PoolId, shares: number) {
    const pos = this.position(poolId, this.actor);
    if (!(shares > 0) || shares > pos.shares + 1e-9) throw new ClientError("You can't withdraw more shares than you hold.");
    pos.shares -= shares;
    pos.locked += shares;
    const pool = this.state.pools[poolId];
    const seq = (pool.withdrawQueue.at(-1)?.seq ?? 0) + 1;
    pool.withdrawQueue.push({ seq, owner: this.actor, shares, requestedAt: Date.now() });
    this.emit();
    return mockSig();
  }

  async processWithdrawals(poolId: PoolId) {
    const pool = this.state.pools[poolId];
    // Up to 3 requests per transaction, paid at the NAV of this moment, from free cash only.
    let processed = 0;
    const keep: PoolState["withdrawQueue"] = [];
    for (const req of pool.withdrawQueue) {
      const amount = req.shares * this.sharePrice(poolId);
      if (processed < 3 && amount <= pool.idleCash) {
        pool.idleCash -= amount;
        pool.totalShares -= req.shares;
        this.position(poolId, req.owner).locked -= req.shares;
        this.credit(req.owner, amount);
        processed++;
      } else {
        keep.push(req);
      }
    }
    pool.withdrawQueue = keep;
    if (processed === 0) throw new ClientError("No request could be paid from free cash right now.");
    this.recordPrice(poolId);
    this.emit();
    return mockSig();
  }

  // ---------------------------------------------------------------- borrower flow

  async applyLoan(args: ApplyLoanArgs) {
    const p = POOLS[args.poolId];
    if (args.seller === this.actor) throw new ClientError("The seller must use a different wallet from the borrower.");
    if (!args.seller) throw new ClientError("The seller has to co-sign the application.");
    const minDown = args.price * (1 - p.maxLtv);
    if (args.downPayment + 1e-6 < minDown) throw new ClientError(`Down payment must be at least ${Math.round((1 - p.maxLtv) * 100)}% of the price.`);
    const pool = this.state.pools[args.poolId];
    const principal = round2(args.price - args.downPayment);
    const installment = round2(monthlyPayment(principal, p.annualRate, p.termMonths));
    const fee = round2(principal * p.originationFee);
    const collateral = round2(installment * p.collateralInstallments);
    // Down payment, 1% fee and 3 installments of collateral move into this loan's escrow now.
    this.debit(this.actor, args.downPayment + fee + collateral, "the down payment, fee and collateral");
    const seq = pool.nextLoanSeq++;
    const key = loanKey(args.poolId, seq);
    const now = Date.now();
    const sig = mockSig();
    this.state.loans.set(key, {
      key,
      poolId: args.poolId,
      seq,
      status: "Pending",
      price: args.price,
      appraisal: null,
      downPayment: round2(args.downPayment),
      principal,
      remainingPrincipal: principal,
      annualRate: p.annualRate,
      termMonths: p.termMonths,
      installment,
      paidInstallments: 0,
      missedInstallments: 0,
      nextDueAt: null,
      lateFeeDue: 0,
      collateral,
      originationFee: fee,
      provision: 0,
      accruedInterest: 0,
      region: args.region,
      borrower: this.actor,
      seller: args.seller,
      docHash: null,
      assetRefHash: args.assetRefHash,
      createdAt: now,
      events: [{ at: now, kind: "applied", amount: args.downPayment, signature: sig.signature, by: this.actor }],
    });
    this.emit();
    return { ...sig, loanKey: key };
  }

  async approveLoan(key: string, appraisal: number, docHash: string) {
    const loan = this.loan(key);
    if (loan.status !== "Pending" || loan.appraisal !== null) throw new ClientError("Only a pending application can be approved.");
    loan.appraisal = appraisal;
    loan.docHash = docHash;
    return this.event(loan, { kind: "approved", amount: appraisal });
  }

  async rejectLoan(key: string) {
    const loan = this.loan(key);
    if (loan.status !== "Pending") throw new ClientError("Only a pending application can be rejected.");
    loan.status = "Rejected";
    this.credit(loan.borrower, loan.downPayment + loan.originationFee + loan.collateral);
    return this.event(loan, { kind: "rejected", note: "Down payment, fee and collateral returned to the borrower" });
  }

  async fundLoan(key: string) {
    const loan = this.loan(key);
    const pool = this.state.pools[loan.poolId];
    const p = pool.params;
    if (loan.status !== "Pending" || loan.appraisal === null) throw new ClientError("The underwriter has to approve the loan first.");
    const value = Math.min(loan.price, loan.appraisal);
    if (loan.principal / value > p.maxLtv + 1e-9) {
      throw new ClientError(`LTV ${((loan.principal / value) * 100).toFixed(1)}% is above the ${p.maxLtv * 100}% limit (value = min(price, appraisal)).`);
    }
    const m = computeMetrics(pool, [...this.state.loans.values()]);
    if (m.brakeOn) throw new ClientError(`New lending is paused: ${m.brakeReason}.`);
    if (loan.principal > m.lendableCash) throw new ClientError("Not enough free cash after the 10% liquidity buffer.");
    pool.idleCash -= loan.principal;
    pool.outstandingPrincipal += loan.principal;
    pool.escrowed += loan.principal;
    loan.status = "Funded";
    return this.event(loan, { kind: "funded", amount: loan.principal, note: "Pool money is in escrow until the title is confirmed" });
  }

  async confirmTitle(key: string) {
    const loan = this.loan(key);
    if (loan.status !== "Funded") throw new ClientError("The loan has to be funded first.");
    const pool = this.state.pools[loan.poolId];
    pool.escrowed -= loan.principal;
    pool.reserve += loan.originationFee / 2;
    pool.platformFees += loan.originationFee / 2;
    loan.status = "Active";
    loan.nextDueAt = Date.now() + pool.params.periodSeconds * 1000;
    return this.event(loan, { kind: "title_confirmed", amount: loan.price, note: "Escrow paid to the seller" });
  }

  async repay(key: string) {
    const loan = this.loan(key);
    if (!["Active", "Late1", "Late2"].includes(loan.status)) throw new ClientError("This loan isn't taking payments.");
    this.debit(this.actor, this.due(loan).total, "this installment");
    this.applyInstallment(loan, Date.now(), "repaid");
    this.recordPrice(loan.poolId);
    this.emit();
    return { signature: loan.events.at(-1)?.signature ?? mockSig().signature, mock: true };
  }

  async crankLoan(key: string) {
    const loan = this.loan(key);
    const pool = this.state.pools[loan.poolId];
    const p = pool.params;
    const sig = mockSig();
    if (!["Active", "Late1", "Late2"].includes(loan.status) || loan.nextDueAt === null) {
      return { ...sig, changed: false, message: "Nothing to process for this loan." };
    }
    // State comes from the clock, not from a counter: missed = (now − due − grace) / period.
    const now = Date.now();
    const overdue = now - loan.nextDueAt - p.graceSeconds * 1000;
    if (overdue < 0) return { ...sig, changed: false, message: "Not overdue yet. Nothing changed." };
    const missed = Math.floor(overdue / (p.periodSeconds * 1000)) + 1;
    if (missed <= loan.missedInstallments) return { ...sig, changed: false, message: "Already processed for this period. Nothing changed." };

    const r = p.annualRate / 12;
    while (loan.missedInstallments < missed && loan.status !== "Defaulted") {
      loan.missedInstallments++;
      loan.accruedInterest = round2(loan.accruedInterest + loan.remainingPrincipal * r);
      if (loan.missedInstallments === 1) {
        loan.status = "Late1";
        loan.lateFeeDue = round2(loan.lateFeeDue + loan.installment * p.lateFee);
        this.setProvision(loan, round2(loan.remainingPrincipal * p.provisionRates[1]));
        loan.events.push({ at: now, kind: "late1", note: "Grace period passed; 2% late fee added", signature: sig.signature, by: this.actor });
      } else if (loan.missedInstallments === 2) {
        loan.status = "Late2";
        const taken = Math.min(loan.collateral, loan.installment);
        loan.collateral = round2(loan.collateral - taken);
        const interest = Math.min(taken, round2(loan.remainingPrincipal * r));
        const principal = round2(taken - interest);
        loan.remainingPrincipal = round2(loan.remainingPrincipal - principal);
        loan.accruedInterest = Math.max(0, round2(loan.accruedInterest - interest));
        pool.outstandingPrincipal -= principal;
        pool.idleCash += taken;
        this.setProvision(loan, round2(loan.remainingPrincipal * p.provisionRates[2]));
        loan.events.push({ at: now, kind: "late2", amount: taken, note: "Installment taken from collateral", signature: sig.signature, by: this.actor });
      } else {
        loan.status = "Defaulted";
        const value = Math.min(loan.price, loan.appraisal ?? loan.price);
        const expectedLoss = loan.remainingPrincipal + loan.accruedInterest - loan.collateral - p.recoveryCoeff * value;
        this.setProvision(loan, round2(Math.max(p.provisionRates[3] * loan.remainingPrincipal, expectedLoss)));
        loan.events.push({ at: now, kind: "defaulted", note: "Licensed servicer starts the legal process off-chain", signature: sig.signature, by: this.actor });
      }
    }
    this.recordPrice(loan.poolId);
    this.emit();
    return { ...sig, changed: true, message: `Loan is now ${loan.status}.` };
  }

  async recordRecovery(key: string, proceeds: number) {
    const loan = this.loan(key);
    if (loan.status !== "Defaulted") throw new ClientError("Only a defaulted loan can record a recovery.");
    const pool = this.state.pools[loan.poolId];
    // Loss order: collateral → sale proceeds → (underwriter stake) → first-loss vault → reserve → investors.
    const claim = loan.remainingPrincipal + loan.accruedInterest;
    const covered = loan.collateral + proceeds;
    const loss = Math.max(0, claim - covered);
    const fromFirstLoss = Math.min(loss, pool.firstLossVault);
    const fromReserve = Math.min(loss - fromFirstLoss, pool.reserve);
    pool.firstLossVault -= fromFirstLoss;
    pool.reserve -= fromReserve;
    pool.idleCash += covered + fromFirstLoss + fromReserve;
    pool.outstandingPrincipal -= loan.remainingPrincipal;
    this.setProvision(loan, 0);
    loan.remainingPrincipal = 0;
    loan.collateral = 0;
    loan.status = "Recovered";
    const toInvestors = loss - fromFirstLoss - fromReserve;
    return this.event(loan, {
      kind: "recovered",
      amount: proceeds,
      note: `Loss ${fmt(loss)}: first-loss vault ${fmt(fromFirstLoss)}, reserve ${fmt(fromReserve)}, investors ${fmt(toInvestors)}`,
    });
  }

  // ---------------------------------------------------------------- internals

  /** mock: simulated on-time borrowers pay automatically, so the share price moves like it would on devnet. */
  private tick() {
    const now = Date.now();
    let changed = false;
    for (const loan of this.state.loans.values()) {
      if (!loan.autopay || loan.status !== "Active" || loan.nextDueAt === null) continue;
      let guard = 0;
      while (loan.nextDueAt !== null && loan.nextDueAt <= now && loan.status === "Active" && guard++ < 3) {
        this.applyInstallment(loan, loan.nextDueAt, "repaid");
        changed = true;
      }
      // Skip ahead if the tab was asleep for a long time, without paying for the gap.
      const period = POOLS[loan.poolId].periodSeconds * 1000;
      if (loan.nextDueAt !== null && loan.nextDueAt <= now) loan.nextDueAt = now + period;
    }
    if (changed) {
      this.recordPrice("house");
      this.recordPrice("vehicle");
      queueMicrotask(() => this.emit());
    }
  }

  private applyInstallment(loan: Loan, at: number, kind: LoanEvent["kind"]) {
    const pool = this.state.pools[loan.poolId];
    const p = pool.params;
    const { interest, principalPart, fee } = this.due(loan);

    loan.remainingPrincipal = round2(loan.remainingPrincipal - principalPart);
    loan.paidInstallments++;
    loan.lateFeeDue = 0;
    loan.accruedInterest = 0;
    pool.outstandingPrincipal -= principalPart;
    // Interest split: e.g. 7% = 6% pool + 0.5% platform + 0.5% reserve.
    const toPool = interest * (p.poolRate / p.annualRate);
    const toPlatform = interest * (p.platformRate / p.annualRate);
    const toReserve = interest - toPool - toPlatform;
    pool.idleCash += principalPart + toPool + fee;
    pool.platformFees += toPlatform;
    pool.reserve += toReserve;

    const period = p.periodSeconds * 1000;
    loan.nextDueAt = (loan.nextDueAt ?? at) + period;
    const sig = mockSig();
    loan.events.push({ at, kind, amount: round2(interest + principalPart + fee), signature: sig.signature, by: loan.borrower });

    if (loan.remainingPrincipal <= 0) {
      loan.status = "PaidOff";
      loan.nextDueAt = null;
      this.setProvision(loan, 0);
      this.credit(loan.borrower, loan.collateral);
      loan.collateral = 0; // returned to the borrower
      loan.events.push({ at, kind: "paid_off", note: "Collateral returned, lien released" });
      return;
    }
    // Caught up? Back to Active and the provision is released.
    if (loan.status !== "Active" && loan.nextDueAt + p.graceSeconds * 1000 > Date.now()) {
      loan.status = "Active";
      loan.missedInstallments = 0;
      this.setProvision(loan, 0);
    } else if (loan.status !== "Active") {
      loan.missedInstallments = Math.max(0, loan.missedInstallments - 1);
    }
  }

  /** What the next installment is made of. Payment order: late fee → interest → principal; the last one is remaining + interest. */
  private due(loan: Loan) {
    const r = POOLS[loan.poolId].annualRate / 12;
    const interest = round2(loan.remainingPrincipal * r);
    const isLast = loan.installment - interest >= loan.remainingPrincipal;
    const principalPart = isLast ? loan.remainingPrincipal : round2(loan.installment - interest);
    const fee = loan.lateFeeDue;
    return { interest, principalPart, fee, total: round2(interest + principalPart + fee) };
  }

  private wallet(owner: string) {
    let b = this.state.balances.get(owner);
    if (b === undefined) {
      b = MOCK_STARTING_BALANCE;
      this.state.balances.set(owner, b);
    }
    return b;
  }

  private debit(owner: string, amount: number, what: string) {
    const have = this.wallet(owner);
    if (amount > have + 1e-6) {
      throw new ClientError("Not enough USDC in this wallet: " + what + " needs " + fmt2(amount) + " and the wallet holds " + fmt2(have) + ".");
    }
    this.state.balances.set(owner, round2(have - amount));
  }

  private credit(owner: string, amount: number) {
    if (amount > 0) this.state.balances.set(owner, round2(this.wallet(owner) + amount));
  }

  private setProvision(loan: Loan, value: number) {
    const pool = this.state.pools[loan.poolId];
    pool.lossProvision = round2(pool.lossProvision - loan.provision + value);
    loan.provision = value;
  }

  private event(loan: Loan, e: Omit<LoanEvent, "at" | "signature" | "by">) {
    const sig = mockSig();
    loan.events.push({ ...e, at: Date.now(), signature: sig.signature, by: this.actor });
    this.recordPrice(loan.poolId);
    this.emit();
    return sig;
  }

  private loan(key: string): Loan {
    const l = this.state.loans.get(key);
    if (!l) throw new ClientError(`Loan ${key} not found.`);
    return l;
  }

  private position(poolId: PoolId, owner: string) {
    const map = this.state.positions[poolId];
    let pos = map.get(owner);
    if (!pos) {
      pos = { shares: 0, locked: 0 };
      map.set(owner, pos);
    }
    return pos;
  }

  private sharePrice(poolId: PoolId) {
    return computeMetrics(this.state.pools[poolId], [...this.state.loans.values()]).sharePrice;
  }

  private recordPrice(poolId: PoolId) {
    const price = this.sharePrice(poolId);
    const hist = this.state.history[poolId];
    const last = hist.at(-1);
    if (!last || Math.abs(last.price - price) > 1e-9) hist.push({ at: Date.now(), price });
  }

  private clonePool(id: PoolId): PoolState {
    const p = this.state.pools[id];
    return { ...p, withdrawQueue: p.withdrawQueue.map((w) => ({ ...w })) };
  }
}

function cloneLoan(l: Loan): Loan {
  return { ...l, events: l.events.map((e) => ({ ...e })) };
}

function fmt2(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

