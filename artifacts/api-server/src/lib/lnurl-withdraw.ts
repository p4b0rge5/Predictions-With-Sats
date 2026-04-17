function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function toLnurlWithdrawDescription(value: string, maxLength = 120): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "PWSats payout";

  if (normalized.length <= maxLength) return normalized;

  return collapseWhitespace(normalized.slice(0, maxLength - 3)) + "...";
}
