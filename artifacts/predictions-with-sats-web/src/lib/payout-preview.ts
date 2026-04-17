export const SETTLEMENT_FEE_RATE = 0.02;
export const REFUND_FEE_RATE = 0.005;

export interface PoolProjection {
  payoutSats: number;
  profitSats: number;
  roiPct: number;
}

export function getProjectedPayout({
  stakeSats,
  selectedPoolSats,
  totalPoolSats,
  feeRate = SETTLEMENT_FEE_RATE,
}: {
  stakeSats: number;
  selectedPoolSats: number;
  totalPoolSats: number;
  feeRate?: number;
}): PoolProjection | null {
  if (stakeSats <= 0) return null;

  const nextSelectedPool = Math.max(0, selectedPoolSats) + stakeSats;
  const nextTotalPool = Math.max(0, totalPoolSats) + stakeSats;
  if (nextSelectedPool <= 0 || nextTotalPool <= 0) return null;

  const payoutSats = Math.max(
    0,
    Math.floor(nextTotalPool * (1 - feeRate) * (stakeSats / nextSelectedPool)),
  );
  const profitSats = payoutSats - stakeSats;
  const roiPct = (profitSats / stakeSats) * 100;

  return { payoutSats, profitSats, roiPct };
}

export function getCurrentStakePayout({
  stakeSats,
  selectedPoolSats,
  totalPoolSats,
  feeRate = SETTLEMENT_FEE_RATE,
}: {
  stakeSats: number;
  selectedPoolSats: number;
  totalPoolSats: number;
  feeRate?: number;
}): PoolProjection | null {
  if (stakeSats <= 0 || selectedPoolSats <= 0 || totalPoolSats <= 0) return null;

  const payoutSats = Math.max(
    0,
    Math.floor(totalPoolSats * (1 - feeRate) * (stakeSats / selectedPoolSats)),
  );
  const profitSats = payoutSats - stakeSats;
  const roiPct = (profitSats / stakeSats) * 100;

  return { payoutSats, profitSats, roiPct };
}

export function getRefundProjection(stakeSats: number, feeRate = REFUND_FEE_RATE): PoolProjection | null {
  if (stakeSats <= 0) return null;

  const payoutSats = Math.max(0, Math.floor(stakeSats * (1 - feeRate)));
  const profitSats = payoutSats - stakeSats;
  const roiPct = (profitSats / stakeSats) * 100;

  return { payoutSats, profitSats, roiPct };
}

export function getPoolMultiple({
  selectedPoolSats,
  totalPoolSats,
  feeRate = SETTLEMENT_FEE_RATE,
}: {
  selectedPoolSats: number;
  totalPoolSats: number;
  feeRate?: number;
}): number | null {
  if (selectedPoolSats <= 0 || totalPoolSats <= 0) return null;
  return (totalPoolSats * (1 - feeRate)) / selectedPoolSats;
}
