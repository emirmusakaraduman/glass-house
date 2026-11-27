# Demo video plan (target 2:40, hard limit under 3:00)

Draft for the team. Narration is about 150 words per minute, so each beat has a word budget.
Record the screen on the live app (or `npm run dev` with `NEXT_PUBLIC_DATA_SOURCE=chain`), voice-over
afterwards. Every claim below is something the repo actually does; if a beat does not work on the
day, cut the beat instead of faking it.

| Time | Screen | Narration (draft) |
|---|---|---|
| 0:00–0:15 | Landing (`00-landing`) | "Maria earns in USDC in Panama, but local banks do not count that income. GlassHouse is a Solana credit protocol that lets her borrow against a home, funded by verified investors." |
| 0:15–0:35 | Finder (`01`, `02`) | "Her budget gives a maximum price. The listing finder shows homes below it. Today these are labelled sample listings: the two sites we checked forbid scraping." |
| 0:35–1:05 | Apply (`03`–`06`) | "She applies together with the seller. The 30% down payment and a 1% fee go into escrow. Only a salted hash and a value band go on-chain, no name, address or listing URL." |
| 1:05–1:35 | Loan flow (`07`–`09`) | "An underwriter approves, anyone can fund it, because every rule is checked on-chain. The title agent confirms registration, and the loan turns Active." |
| 1:35–1:50 | Instalment (`10`) | "She pays a 542.71 USDC instalment. Interest is split between the pool, the platform and a reserve." |
| 1:50–2:10 | Invest dashboard (`11`) | "Investors see pool value from internal counters, not token balances, so donating to a vault cannot move the price." |
| 2:10–2:35 | Default and loss stack (`12`–`14`) | "If a borrower stops paying, the loss is absorbed layer by layer, in public: the borrower's collateral, the sale proceeds, then the platform's first-loss vault, then the reserve, and only then investors." |
| 2:35–2:50 | Stress panel (`15`, `16`) | "We stress-tested 100 loans. At a 30% house price drop investors lose nothing; at 40% they start to." |
| 2:50–2:58 | Close | "Devnet prototype with mock USDC, MIT licensed, not audited. Code: github.com/emirmusakaraduman/glass-house." |

## Before recording

- Seed is complete (13 loans) and `verify-devnet.ts` passes. Use the loans it created, do not create new ones on camera.
- Late and defaulted examples exist in the seed (house: 2 Late1, 1 Defaulted), so beat 2:10 needs no setup.
- Check every number on screen against the app. Do not read a figure you have not seen on the page.
- Keep the honest limits in: devnet, mock USDC, no licensed lender yet, no audit.
- Export under 3:00. Check the exact deadline and upload rules on the hackathon panel.
