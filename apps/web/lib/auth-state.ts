export const walletAuthenticationRequired = (sessionToken?: string) =>
  sessionToken === undefined || sessionToken.trim().length === 0;
