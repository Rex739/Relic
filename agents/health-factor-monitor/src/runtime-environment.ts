export interface ReferenceRuntimeEnvironment {
  agentUrl: string;
  databaseUrl: string;
  fundedPollInterval: number;
  keystoreDirectory: string;
  port: number;
  walletAddress: `0x${string}`;
  walletPassword: string;
}

const required = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const positiveInteger = (value: string, name: string, maximum: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum)
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return parsed;
};

const evmAddress = (
  environment: NodeJS.ProcessEnv,
  name: string,
): `0x${string}` => {
  const value = required(environment, name);
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value))
    throw new Error(`${name} must be a 20-byte 0x-prefixed EVM address`);
  return value as `0x${string}`;
};

export function parseReferenceRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
): ReferenceRuntimeEnvironment {
  if (environment.PRIVATE_KEY)
    throw new Error(
      "PRIVATE_KEY is forbidden in the reference runtime; inject the existing encrypted keystore instead",
    );
  if (environment.NETWORK !== "bsc-testnet")
    throw new Error("The reference runtime is locked to NETWORK=bsc-testnet");
  if (environment.ERC8183_SERVICE_PRICE !== "0")
    throw new Error("ERC8183_SERVICE_PRICE must be exactly 0");

  const databaseUrl = required(environment, "DATABASE_URL");
  if (!databaseUrl.startsWith("postgresql://"))
    throw new Error("DATABASE_URL must use postgresql://");

  const agentUrl = new URL(required(environment, "ERC8183_AGENT_URL"));
  if (environment.NODE_ENV === "production" && agentUrl.protocol !== "https:")
    throw new Error("ERC8183_AGENT_URL must use HTTPS in production");
  if (!agentUrl.pathname.replace(/\/+$/, "").endsWith("/erc8183"))
    throw new Error("ERC8183_AGENT_URL must end with /erc8183");

  required(environment, "BSC_TESTNET_RPC_URL");
  required(environment, "RPC_URL_BSC_TESTNET");
  required(environment, "ERC8183_POLICY_ADDRESS");
  required(environment, "VENUS_BSC_TESTNET_COMPTROLLER");

  return {
    agentUrl: agentUrl.toString().replace(/\/+$/, ""),
    databaseUrl,
    fundedPollInterval: positiveInteger(
      environment.ERC8183_FUNDED_POLL_INTERVAL ?? "15",
      "ERC8183_FUNDED_POLL_INTERVAL",
      3600,
    ),
    keystoreDirectory: required(environment, "WALLET_KEYSTORE_DIR"),
    port: positiveInteger(environment.PORT ?? "8003", "PORT", 65_535),
    walletAddress: evmAddress(environment, "WALLET_ADDRESS"),
    walletPassword: required(environment, "WALLET_PASSWORD"),
  };
}
