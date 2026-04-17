import { createHash } from "node:crypto";

export function deriveWithdrawK1(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
