export * from "./client";
export { MockClient } from "./mock";
export { DEMO_WALLET } from "./mock-seed";
export { explorerAddress, explorerTx } from "./anchor";

export type DataSource = "mock" | "chain";

export const DATA_SOURCE: DataSource = process.env.NEXT_PUBLIC_DATA_SOURCE === "chain" ? "chain" : "mock";
