export type SellerClaimSubmission = {
  id: string;
  chainId: 56 | 97;
  registryAddress: string;
  externalAgentId: string;
  currentOwner: string;
  name: string | null;
  ownershipVerifiedAt: string | null;
};

export type SellerOwnershipChallenge = {
  id: string;
  message: string;
  expectedOwner: string;
  issuedAt: string;
  expiresAt: string;
};

export const ownershipChallengeFilename = (
  externalAgentId: string,
  challengeId: string,
) => `relic-agent-ownership-${externalAgentId}-${challengeId}.txt`;

export const studioSigningCommand = (
  externalAgentId: string,
  challengeId: string,
) => {
  const filename = ownershipChallengeFilename(externalAgentId, challengeId);
  return [
    'printf "Enter your Agent Studio wallet password: "',
    "read -rs WALLET_PASSWORD",
    'printf "\\n"',
    "export WALLET_PASSWORD",
    "",
    `message="$(<"$HOME/Downloads/${filename}")"`,
    "",
    'if [ -x ".venv/bin/bag" ]; then BAG=".venv/bin/bag"; else BAG="bag"; fi',
    '"$BAG" wallet sign \\',
    "  --project-root . \\",
    '  --msg "$message"',
    "",
    "unset message",
    "unset WALLET_PASSWORD",
    "unset BAG",
  ].join("\n");
};

export const ownershipChallengeBytes = (message: string) => {
  if (message.endsWith("\n") || message.includes("\r"))
    throw new Error("Ownership challenge is not canonical LF text");
  return new TextEncoder().encode(message);
};

export const studioOwnershipProviderNotice =
  "Agent Studio message signing works with evm-local, TWAK and Turnkey wallets. Altana-backed agents should use the owner/admin browser-wallet route where available; Altana session keys are not ownership proof.";

export const browserOwnerMismatchMessage = (
  externalAgentId: string,
  expectedOwner: string,
) =>
  `This wallet does not own Agent #${externalAgentId}. Expected owner: ${expectedOwner}. Connect the owner wallet or verify using BNB Agent Studio.`;

export const ownershipErrorMessage = (payload: unknown, fallback: string) => {
  if (payload !== null && typeof payload === "object") {
    const record = payload as {
      error?: string | { message?: string };
    };
    if (typeof record.error === "string") return record.error;
    if (typeof record.error?.message === "string") return record.error.message;
  }
  return fallback;
};
