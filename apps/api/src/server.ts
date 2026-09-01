import { serve } from "@hono/node-server";
import { getServerEnvironment } from "@relic/config";
import {
  createDatabase,
  DrizzleAgentRepository,
  DrizzleCommerceStore,
  DrizzleExecutionStore,
  DrizzleMandateStore,
  DrizzleOnboardingStore,
  DrizzleWalletAuthStore,
} from "@relic/database";
import type { AgentReadRepository } from "@relic/domain";

import { createApp } from "./app.js";
import { MandateApplicationService } from "./mandates.js";
import { ExecutionApplicationService } from "./executions.js";
import {
  CommerceApplicationService,
  USER_COMMERCE_JOB_LIFETIME_SECONDS,
  WalletAuthenticationService,
} from "./commerce.js";
import {
  SellerAuthorizationGuard,
  ViemErc8004OwnershipReader,
} from "./seller-ownership.js";

class EmptyAgentRepository implements AgentReadRepository {
  public async list() {
    return Promise.resolve({ items: [], nextCursor: null });
  }
  public async findById() {
    return Promise.resolve(null);
  }
}

const environment = getServerEnvironment();
const connection =
  environment.DATABASE_URL === undefined
    ? null
    : createDatabase(environment.DATABASE_URL);
const repository =
  connection === null
    ? new EmptyAgentRepository()
    : new DrizzleAgentRepository(connection.db);
const onboarding =
  connection === null ? undefined : new DrizzleOnboardingStore(connection.db);
const ownershipReader = new ViemErc8004OwnershipReader({
  mainnetRpcUrl: environment.BSC_MAINNET_RPC_URL,
  testnetRpcUrl: environment.BSC_TESTNET_RPC_URL,
});
const sellerAuthorization =
  onboarding === undefined
    ? undefined
    : new SellerAuthorizationGuard(onboarding, ownershipReader);
const mandates =
  connection === null
    ? undefined
    : new MandateApplicationService(
        repository,
        new DrizzleMandateStore(connection.db),
      );
const executions =
  connection === null
    ? undefined
    : new ExecutionApplicationService(
        repository,
        new DrizzleMandateStore(connection.db),
        new DrizzleExecutionStore(connection.db),
        {
          ...(process.env.BSC_TESTNET_RPC_URL === undefined
            ? {}
            : { bscTestnetRpcUrl: process.env.BSC_TESTNET_RPC_URL }),
          ...(process.env.VENUS_BSC_TESTNET_COMPTROLLER === undefined
            ? {}
            : {
                venusBscTestnetComptroller:
                  process.env.VENUS_BSC_TESTNET_COMPTROLLER,
              }),
        },
      );
const walletAuth =
  connection === null
    ? undefined
    : new WalletAuthenticationService(
        new DrizzleWalletAuthStore(connection.db),
        environment.RELIC_WALLET_AUTH_DOMAIN ?? "localhost",
        environment.RELIC_WALLET_AUTH_URI ?? "http://localhost:3000",
      );
const commerceAuthorizerAddress =
  environment.RELIC_COMMERCE_AUTHORIZER_ADDRESS ??
  (environment.NODE_ENV === "production"
    ? undefined
    : environment.ERC8183_POLICY_ADDRESS);
if (
  connection !== null &&
  environment.NODE_ENV === "production" &&
  (environment.RELIC_WALLET_AUTH_DOMAIN === undefined ||
    environment.RELIC_WALLET_AUTH_URI === undefined ||
    commerceAuthorizerAddress === undefined ||
    environment.RELIC_ERC8183_COMMERCE_ADDRESS === undefined ||
    environment.RELIC_ERC8183_EVALUATOR_ADDRESS === undefined)
)
  throw new Error(
    "Production commerce requires wallet-auth, authorizer, ERC-8183 commerce, and evaluator configuration",
  );
const commerce =
  connection === null || commerceAuthorizerAddress === undefined
    ? undefined
    : new CommerceApplicationService(
        new DrizzleCommerceStore(connection.db),
        commerceAuthorizerAddress as `0x${string}`,
        () => new Date(),
        environment.RELIC_ERC8183_COMMERCE_ADDRESS === undefined ||
          environment.RELIC_ERC8183_EVALUATOR_ADDRESS === undefined
          ? undefined
          : {
              commerceAddress:
                environment.RELIC_ERC8183_COMMERCE_ADDRESS as `0x${string}`,
              evaluatorAddress:
                environment.RELIC_ERC8183_EVALUATOR_ADDRESS as `0x${string}`,
              ...(environment.ERC8183_POLICY_ADDRESS === undefined
                ? {}
                : {
                    policyAddress:
                      environment.ERC8183_POLICY_ADDRESS as `0x${string}`,
                  }),
              ...(process.env.BSC_TESTNET_RPC_URL === undefined
                ? {}
                : { rpcUrl: process.env.BSC_TESTNET_RPC_URL }),
            },
        sellerAuthorization,
      );
const mandateApiSecret =
  environment.MANDATE_API_SECRET ??
  (environment.NODE_ENV === "production"
    ? undefined
    : "relic-local-development-mandate-secret-not-production");
if (mandates !== undefined && mandateApiSecret === undefined)
  throw new Error("MANDATE_API_SECRET is required when mandates are enabled");
const app = createApp(repository, onboarding, mandates, {
  ...(mandateApiSecret === undefined ? {} : { mandateApiSecret }),
  ...(executions === undefined ? {} : { executionService: executions }),
  ...(walletAuth === undefined ? {} : { walletAuthService: walletAuth }),
  ...(environment.NEXT_PUBLIC_PRIVY_APP_ID === undefined
    ? {}
    : { privyAppId: environment.NEXT_PUBLIC_PRIVY_APP_ID }),
  ...(environment.PRIVY_JWT_VERIFICATION_KEY === undefined
    ? {}
    : { privyJwtVerificationKey: environment.PRIVY_JWT_VERIFICATION_KEY }),
  ...(commerce === undefined ? {} : { commerceService: commerce }),
  ownershipReader,
  ...(sellerAuthorization === undefined
    ? {}
    : { sellerAuthorizationGuard: sellerAuthorization }),
  publicOrigin: environment.RELIC_PUBLIC_ORIGIN ?? "http://localhost:3000",
  environmentName: environment.NODE_ENV,
});

serve({ fetch: app.fetch, port: environment.API_PORT }, (info) => {
  console.info(
    JSON.stringify({
      event: "relic_api_runtime_config",
      userCommerceJobLifetimeSeconds:
        USER_COMMERCE_JOB_LIFETIME_SECONDS.toString(),
      jobExpiryIncludesPolicyDisputeWindow: true,
    }),
  );
  console.info(`Relic API listening on http://localhost:${info.port}`);
});

if (connection !== null) {
  const shutdown = async () => {
    await connection.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
