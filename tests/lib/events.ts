// Anchor event'lerini ham program loglarından çözer ("Program data: <base64>").
//
// Neden EventParser değil: Anchor'ın EventParser'ı u64 alanları BN olarak döndürür ve bu pakette
// bn.js çok sözcüklü değerlerde (> 2^26, örn. 50.000 USDC) bozuk BN üretiyor ("...NaN"). Burada
// alanlar doğrudan baytlardan BigInt/number olarak okunur. Event'in 8 baytlık ayırt edicisi IDL'den alınır.

import { PublicKey } from "@solana/web3.js";
import type { TestEnv } from "../helpers";

export type FieldType = "pubkey" | "u64" | "i64" | "u16" | "u8" | "bool";

/** Alan listesi, Rust struct'taki sırayla: [ad, tip]. */
export type EventLayout = ReadonlyArray<readonly [string, FieldType]>;

const SIZE: Record<FieldType, number> = { pubkey: 32, u64: 8, i64: 8, u16: 2, u8: 1, bool: 1 };

/**
 * `logs` içinde `eventName` adlı event'i bulur ve çözer. Tam olarak bir tane bekler.
 * u64/i64 → bigint, u16/u8 → number, pubkey → PublicKey, bool → boolean.
 */
export function decodeEvent(
  env: TestEnv,
  logs: string[],
  eventName: string,
  layout: EventLayout,
): Record<string, any> {
  const events = env.program?.idl.events ?? [];
  const def = events.find((e: any) => e.name.toLowerCase() === eventName.toLowerCase());
  if (!def) throw new Error(`IDL'de ${eventName} event'i yok`);
  const disc = Buffer.from(def.discriminator);

  const hits = logs
    .filter((l) => l.startsWith("Program data: "))
    .map((l) => Buffer.from(l.slice("Program data: ".length), "base64"))
    .filter((b) => b.subarray(0, 8).equals(disc));
  if (hits.length !== 1) throw new Error(`${eventName}: 1 event bekleniyordu, ${hits.length} bulundu`);

  const b = hits[0];
  const expected = 8 + layout.reduce((n, [, t]) => n + SIZE[t], 0);
  if (b.length !== expected) {
    throw new Error(`${eventName}: veri ${b.length} bayt, düzen ${expected} bayt bekliyor (events.rs ile eşleşmiyor)`);
  }
  let o = 8;
  const out: Record<string, any> = {};
  for (const [name, type] of layout) {
    switch (type) {
      case "pubkey":
        out[name] = new PublicKey(b.subarray(o, o + 32));
        break;
      case "u64":
        out[name] = b.readBigUInt64LE(o);
        break;
      case "i64":
        out[name] = b.readBigInt64LE(o);
        break;
      case "u16":
        out[name] = b.readUInt16LE(o);
        break;
      case "u8":
        out[name] = b.readUInt8(o);
        break;
      case "bool":
        out[name] = b.readUInt8(o) !== 0;
        break;
    }
    o += SIZE[type];
  }
  return out;
}

/** lifecycle/events.rs — alan sırası Rust struct'ıyla aynı olmalı. */
export const LOAN_REPAID: EventLayout = [
  ["pool", "pubkey"],
  ["loan", "pubkey"],
  ["loanId", "u64"],
  ["amount", "u64"],
  ["lateFee", "u64"],
  ["interest", "u64"],
  ["principal", "u64"],
  ["remainingPrincipal", "u64"],
  ["status", "u8"],
  ["nextDue", "i64"],
] as const;

/** lifecycle/events.rs RecoveryRecorded. */
export const RECOVERY_RECORDED: EventLayout = [
  ["pool", "pubkey"],
  ["loan", "pubkey"],
  ["loanId", "u64"],
  ["proceeds", "u64"],
  ["collateralUsed", "u64"],
  ["loss", "u64"],
  ["firstLossUsed", "u64"],
  ["reserveUsed", "u64"],
  ["seniorLoss", "u64"],
] as const;
