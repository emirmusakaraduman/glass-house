// Walks the mock client through the demo story: invest → apply → approve → fund → title → repay → crank → recovery.
// Run: npm run check:mock
import { computeMetrics } from "../src/lib/chain/client";
import { MockClient } from "../src/lib/chain/mock";
import { MOCK_STARTING_BALANCE } from "../src/lib/chain/mock-seed";

let fake = Date.now();
Date.now = () => fake;
const advance = (ms: number) => (fake += ms);

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
  console.log("ok  ", msg);
}

async function main() {
  const c = new MockClient();
  const metrics = async (id: "house" | "vehicle") => computeMetrics((await c.getPool(id))!, await c.getLoans());

  const m0 = await metrics("house");
  assert(Math.abs(m0.sharePrice - 1.0418) < 1e-6, `house share price starts at 1.0418 (${m0.sharePrice.toFixed(6)})`);
  assert(!m0.brakeOn, `house brake off (${m0.brakeReason ?? "none"})`);
  assert(m0.seniorImpairment === 0, "Late-1 provision is covered by the first-loss vault");

  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const bal = () => c.getWalletBalance(c.actor);
  assert((await bal()) === MOCK_STARTING_BALANCE, `demo wallet starts with ${MOCK_STARTING_BALANCE} test USDC`);

  let threwBalance = false;
  try {
    await c.deposit("house", MOCK_STARTING_BALANCE + 1);
  } catch (e) {
    threwBalance = true;
    console.log("     ", (e as Error).message);
  }
  assert(threwBalance && (await bal()) === MOCK_STARTING_BALANCE, "deposit above the balance is refused and nothing moves");

  await c.deposit("house", 10_000);
  assert(near(await bal(), MOCK_STARTING_BALANCE - 10_000), "deposit comes out of the wallet");
  const pos = await c.getPosition("house", c.actor);
  assert(pos.shares > 25_000, "deposit mints shares");
  assert(Math.abs((await metrics("house")).sharePrice - m0.sharePrice) < 1e-9, "deposit does not move the share price");

  const seller = "Se11erWa11et1111111111111111111111111111111";
  const { loanKey } = await c.applyLoan({ poolId: "house", price: 100_000, downPayment: 30_000, seller, region: "Panama City", assetRefHash: null });
  assert(loanKey === "house-11", `new loan key ${loanKey}`);
  const applied = (await c.getLoan(loanKey))!;
  const closing = applied.downPayment + applied.originationFee + applied.collateral;
  assert(near(await bal(), MOCK_STARTING_BALANCE - 10_000 - closing), `apply takes down payment + fee + collateral (${closing.toFixed(2)}) from the wallet`);
  let threw = false;
  try {
    await c.applyLoan({ poolId: "house", price: 100_000, downPayment: 20_000, seller, region: "Panama City", assetRefHash: null });
  } catch {
    threw = true;
  }
  assert(threw, "20% down payment is rejected");

  await c.approveLoan(loanKey, 90_000, "ab".repeat(32));
  threw = false;
  try {
    await c.fundLoan(loanKey);
  } catch (e) {
    threw = true;
    console.log("     ", (e as Error).message);
  }
  assert(threw, "LTV is checked against min(price, appraisal)");
  const beforeReject = await bal();
  await c.rejectLoan(loanKey);
  assert(near(await bal(), beforeReject + closing), "a rejected application is refunded to the borrower's wallet");

  const { loanKey: k2 } = await c.applyLoan({ poolId: "house", price: 100_000, downPayment: 30_000, seller, region: "Panama City", assetRefHash: null });
  await c.approveLoan(k2, 102_000, "cd".repeat(32));
  await c.fundLoan(k2);
  assert((await c.getLoan(k2))!.status === "Funded", "funded loan waits in escrow");
  await c.confirmTitle(k2);
  const active = (await c.getLoan(k2))!;
  assert(active.status === "Active" && active.installment === 542.71, `active, installment ${active.installment}`);

  const before = (await metrics("house")).sharePrice;
  const walletBeforeRepay = await bal();
  await c.repay(k2);
  const paid = (await c.getLoan(k2))!.events.at(-1)!.amount!;
  assert(near(await bal(), walletBeforeRepay - paid), `repay takes the installment (${paid.toFixed(2)}) from the wallet`);
  const after = (await metrics("house")).sharePrice;
  assert(after > before, `repayment grows the share price (${before.toFixed(6)} → ${after.toFixed(6)})`);

  // Late loan house-6: crank from a stranger's wallet, minute by minute
  c.setActor("Strangerwa11et11111111111111111111111111111");
  assert((await c.getWalletBalance(c.actor)) === MOCK_STARTING_BALANCE, "a newly connected wallet starts with the same test USDC");
  let r = await c.crankLoan("house-6");
  assert(!r.changed, `crank right away is a no-op: ${r.message}`);
  advance(45_000);
  r = await c.crankLoan("house-6");
  assert(r.changed && (await c.getLoan("house-6"))!.status === "Late2", `after a period: ${r.message}`);
  r = await c.crankLoan("house-6");
  assert(!r.changed, "same period twice does nothing (idempotent)");
  advance(60_000);
  r = await c.crankLoan("house-6");
  const defaulted = (await c.getLoan("house-6"))!;
  assert(defaulted.status === "Defaulted", `then: ${r.message}`);
  const m1 = await metrics("house");
  console.log(`      provision ${defaulted.provision.toFixed(0)}, first-loss left ${m1.firstLossRemaining.toFixed(0)}, senior impairment ${m1.seniorImpairment.toFixed(0)}`);
  assert(m1.seniorImpairment === 0, "first-loss vault absorbs the default; senior share price holds");

  await c.recordRecovery("house-6", 82_000 * 0.7 * 0.9);
  const rec = (await c.getLoan("house-6"))!;
  assert(rec.status === "Recovered", `recovery: ${rec.events.at(-1)?.note}`);

  // withdraw as the demo investor
  c.setActor(null);
  const walletBeforeWithdraw = await bal();
  await c.requestWithdraw("house", 5_000);
  const payout = 5_000 * (await metrics("house")).sharePrice;
  assert((await c.getPool("house"))!.withdrawQueue.length === 1, "withdraw request queued, shares locked");
  await c.processWithdrawals("house");
  assert((await c.getPool("house"))!.withdrawQueue.length === 0, "queue processed at current NAV");
  assert(near(await bal(), walletBeforeWithdraw + payout), `withdrawal pays ${payout.toFixed(2)} into the wallet`);
  console.log("\nall mock checks passed");
}

main();
