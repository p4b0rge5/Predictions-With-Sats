const NO_LIQUIDITY_REFUND_FEE = 0.005;

export function getEffectiveCryptoPayoutSats({
  payoutSats,
  amountSats,
  windowOutcome,
}: {
  payoutSats: number | null;
  amountSats: number;
  windowOutcome: string | null | undefined;
}): number | null {
  if (windowOutcome === "no_liquidity") {
    return Math.floor(amountSats * (1 - NO_LIQUIDITY_REFUND_FEE));
  }
  return payoutSats;
}

