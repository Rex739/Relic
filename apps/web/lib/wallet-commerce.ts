export const isTransactionHash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

export const walletOperationNeedsReconciliation = (state: string) =>
  state === "SUBMITTED" || state === "PENDING" || state === "CONFIRMED";

export const quoteRemainingSeconds = (expiresAt: string, now: number) =>
  Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1_000));

export const quoteHasSafeHeadroom = (
  expiresAt: string,
  minimumRemainingSeconds: number,
  now: number,
) => quoteRemainingSeconds(expiresAt, now) >= minimumRemainingSeconds;

export const walletSubmissionError = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 4001
  )
    return "You cancelled the wallet request. Nothing was submitted.";
  return error instanceof Error
    ? error.message
    : "The wallet action could not be completed.";
};
