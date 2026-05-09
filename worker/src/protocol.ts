// Wire protocol — re-exported from @walgo/mcp-protocol so existing imports
// (./protocol.js) inside worker/src/ keep working without a churn pass on
// every file. Edit the canonical types in packages/protocol/src/index.ts.

export * from "@walgo/mcp-protocol";
