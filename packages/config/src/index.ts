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
  RELIC_CONNECT_SIGNING_PRIVATE_KEY_PEM: z.string().min(32).optional(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NEXT_PUBLIC_API_URL: optionalUrl,
  // The app ID is public, but the verification key must only be available to
  // the API runtime. Together they let Relic exchange a Privy identity token
  // for its own http-only session without asking an embedded wallet to sign.
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().trim().min(1).optional(),
  PRIVY_JWT_VERIFICATION_KEY: z.string().trim().min(1).optional(),
  MANDATE_API_SECRET: z.string().min(32).optional(),
  RELIC_DEVELOPMENT_PRINCIPAL_ID: z.uuid().optional(),
  RELIC_WALLET_AUTH_DOMAIN: z.string().trim().min(1).optional(),
  RELIC_WALLET_AUTH_URI: optionalUrl,
  RELIC_PUBLIC_ORIGIN: optionalUrl,
  RELIC_COMMERCE_AUTHORIZER_ADDRESS: z
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
