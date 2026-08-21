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
  MANDATE_API_SECRET: z.string().min(32).optional(),
  RELIC_DEVELOPMENT_PRINCIPAL_ID: z.uuid().optional(),
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
