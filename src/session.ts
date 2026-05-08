import { randomInt } from "node:crypto";
import type { Network } from "./protocol.js";

export type SessionStatus =
  | { paired: false }
  | { paired: true; address: string; network: Network };

export class Session {
  private status: SessionStatus = { paired: false };
  private pendingCode: string | null = null;

  requestPairing(): string {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pendingCode = code;
    return code;
  }

  tryPair(code: string, address: string, network: Network): boolean {
    if (!this.pendingCode || this.pendingCode !== code) return false;
    this.status = { paired: true, address, network };
    this.pendingCode = null;
    return true;
  }

  getStatus(): SessionStatus {
    return this.status;
  }
}
