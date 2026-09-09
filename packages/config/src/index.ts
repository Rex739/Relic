import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => value || undefined,
  z.url().optional(),
);
const optionalInteger = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : Number(value)),
  z.number().int().nonnegative().optional(),
);

const serverEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url().startsWith("postgresql://").optional(),
  BSC_MAINNET_RPC_URL: z.url().default("https://bsc.publicnode.com"),
  BSC_TESTNET_RPC_URL: z
    .url()
    .default("https://data-seed-prebsc-1-s1.bnbchain.org:8545"),
  NODEREAL_BSC_RPC_URL: optionalUrl,
  ERC8004_CHAIN_ID: z.coerce
    .number()
    .int()
    .refine((id) => id === 56 || id === 97)
    .default(56),
  ERC8004_IDENTITY_REGISTRY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  ERC8004_START_BLOCK: optionalInteger,
  ERC8004_CONFIRMATION_DEPTH: optionalInteger.default(15),
  ERC8004_BLOCK_RANGE: optionalInteger.default(2_000),
  ERC8004_MIN_BLOCK_RANGE: optionalInteger.default(25),
  ERC8004_RPC_RETRIES: optionalInteger.default(3),
  INDEXER_MAX_BLOCKS: optionalInteger,
  "8004SCAN_API_KEY": z.string().min(1).optional(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NEXT_PUBLIC_API_URL: optionalUrl,
  // The app ID is public, but the verification key must only be available to
  // the API runtime. Together they let Relic exchange a Privy identity token
  // for its own http-only session without asking an embedded wallet to sign.
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().trim().min(1).optional(),
  PRIVY_JWT_VERIFICATION_KEY: z.string().trim().min(1).optional(),
  MANDATE_API_SECRET: z.string().min(32).optional(),
  // Service-to-service credential used only by the private Northflank LP
  // runtime to submit a *verified funded job id* to the Relic API. This is
  // intentionally distinct from MANDATE_API_SECRET and buyer sessions.
  RELIC_LP_REBALANCER_INTERNAL_TOKEN: z.string().min(32).optional(),
  // Private Layer A credential and the Relic UUID for the executable Yield
  // Optimizer. Both are required before its durable execution API exists.
  RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN: z.string().min(32).optional(),
  RELIC_YIELD_OPTIMIZER_AGENT_ID: z.uuid().optional(),
  RELIC_YIELD_SESSION_TRANSFER_PUBLIC_KEY: z.string().trim().min(1).optional(),
  // Grid execution is a separate BSC Testnet release. Its buyer session may
  // only be released to the configured private Grid runtime.
  RELIC_GRID_TRADER_INTERNAL_TOKEN: z.string().min(32).optional(),
  RELIC_GRID_TRADER_AGENT_ID: z.uuid().optional(),
  RELIC_GRID_SESSION_TRANSFER_PUBLIC_KEY: z.string().trim().min(1).optional(),
  // Kernel/ZeroDev is the external-wallet path. Keep it opt-in: an agent may
  // never receive autonomous signing authority until its ZeroDev project RPC
  // and sponsorship policy have been explicitly configured.
  RELIC_KERNEL_SESSIONS_ENABLED: z.enum(["true", "false"]).optional(),
  ZERODEV_RPC_URL: optionalUrl,
  GRID_TESTNET_USDT: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  GRID_TESTNET_WBNB: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  GRID_TESTNET_SWAP_ROUTER: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  GRID_TESTNET_POOL: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  GRID_TESTNET_POOL_FEE: z.string().regex(/^\d+$/).optional(),
  GRID_TESTNET_USDT_DECIMALS: z.string().regex(/^(?:0|[1-9]|[1-2]\d|3[0-6])$/).optional(),
  MAX_GRID_JOB_AMOUNT_BASE_UNITS: z.string().regex(/^[1-9]\d*$/).optional(),
  // Mainnet-only Health Guard execution is configured separately from the
  // testnet Yield Optimizer. No address has a source-code fallback.
  RELIC_HEALTH_GUARD_INTERNAL_TOKEN: z.string().min(32).optional(),
  RELIC_HEALTH_GUARD_AGENT_ID: z.uuid().optional(),
  RELIC_HEALTH_GUARD_SESSION_TRANSFER_PUBLIC_KEY: z.string().trim().min(1).optional(),
  // Server-only registry of verified Health Guard pools. Addresses remain out
  // of browser data and are checked again by the private executor.
  HEALTH_GUARD_POOLS_JSON: z.string().trim().min(2).optional(),
  VENUS_MAINNET_USDT: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  VENUS_MAINNET_USDT_VTOKEN: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  VENUS_MAINNET_COMPTROLLER: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  VENUS_MAINNET_USDT_DECIMALS: z.string().regex(/^(?:0|[1-9]|[1-2]\d|3[0-6])$/).optional(),
  // No Yield Optimizer contract address has a source-code fallback. These
  // must be the independently verified BSC Testnet deployments used by the
  // buyer-session authorizer and Layer A runtime.
  VENUS_TESTNET_USDT: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  VENUS_TESTNET_USDT_VTOKEN: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  VENUS_TESTNET_USDT_DECIMALS: z.string().regex(/^(?:0|[1-9]|[1-2]\d|3[0-6])$/).optional(),
  // Absolute testnet spend ceiling shared by marketplace session authorization
  // and the private executor. Keep this in base units for the configured USDT.
  MAX_JOB_AMOUNT_BASE_UNITS: z.string().regex(/^[1-9]\d*$/).optional(),
  // A 32-byte Base64 key injected by ECS from Secrets Manager. It encrypts
  // per-order Altana session keys before they can enter Relic storage.
  ALTANA_SESSION_ENCRYPTION_KEY: z
    .string()
    .trim()
    .refine(
      (value) => {
        try {
          return Buffer.from(value, "base64").length === 32;
        } catch {
          return false;
        }
      },
      "ALTANA_SESSION_ENCRYPTION_KEY must be a Base64-encoded 32-byte key",
    )
    .optional(),
  RELIC_DEVELOPMENT_PRINCIPAL_ID: z.uuid().optional(),
  RELIC_WALLET_AUTH_DOMAIN: z.string().trim().min(1).optional(),
  RELIC_WALLET_AUTH_URI: optionalUrl,
  RELIC_PUBLIC_ORIGIN: optionalUrl,
  // Comma-separated Privy principal UUIDs allowed to use Relic's internal
  // operational tools. Keep this only in server-side environment variables.
  RELIC_ADMIN_PRINCIPAL_IDS: z.string().trim().min(1).optional(),
  // Stable on-chain address used as the EIP-712 verifying-contract field for
  // Relic's buyer commerce approvals. It domain-separates Relic signatures; it
  // is not a separate marketplace authorizer contract.
  RELIC_COMMERCE_EIP712_DOMAIN_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  ERC8183_POLICY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  RELIC_ERC8183_COMMERCE_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  RELIC_ERC8183_EVALUATOR_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  // Mainnet commerce is a separate deployment. None of these values fall
  // back to their Testnet counterparts; a partial Mainnet configuration is
  // intentionally unusable.
  RELIC_MAINNET_COMMERCE_ENABLED: z.enum(["true", "false"]).optional(),
  RELIC_MAINNET_ENABLED_AGENT_IDS: z.string().trim().min(1).optional(),
  RELIC_MAINNET_ERC8004_REGISTRY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  RELIC_MAINNET_ERC8183_COMMERCE_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  RELIC_MAINNET_ERC8183_EVALUATOR_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  RELIC_MAINNET_ERC8183_POLICY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  RELIC_MAINNET_PAYMENT_TOKEN_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  RELIC_MAINNET_PAYMENT_TOKEN_DECIMALS: z.string().regex(/^(?:0|[1-9]|[1-2]\d|3[0-6])$/).optional(),
  RELIC_MAINNET_MAX_JOB_AMOUNT_BASE_UNITS: z.string().regex(/^[1-9]\d*$/).optional(),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(
  environment: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(environment);
}

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= parseServerEnvironment(process.env);
  return cachedEnvironment;
}
