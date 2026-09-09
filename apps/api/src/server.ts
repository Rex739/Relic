import { serve } from "@hono/node-server";
import { getServerEnvironment } from "@relic/config";
import {
  createDatabase,
  DrizzleAgentRepository,
  DrizzleAgentExecutionJobStore,
  DrizzleHealthGuardCycleStore,
  DrizzleAltanaSessionAuthorizationStore,
  DrizzleKernelSessionAuthorizationStore,
  DrizzleCommerceStore,
  DrizzleExecutionStore,
  DrizzleMandateStore,
  DrizzleOnboardingStore,
  DrizzleSupplyStore,
  DrizzleWalletAuthStore,
} from "@relic/database";
import type { AgentReadRepository } from "@relic/domain";

import { createApp } from "./app.js";
import { MandateApplicationService } from "./mandates.js";
import { AltanaSessionAuthorizationService } from "./altana-session-authorization.js";
import { AltanaSessionEncryption } from "./altana-session-encryption.js";
import { KernelSessionAuthorizationService } from "./kernel-session-authorization.js";
import { ExecutionApplicationService } from "./executions.js";
import { PancakeLpRebalanceExecutor } from "./pancake-lp-rebalance-executor.js";
import { LpRebalanceAgentBridge } from "./lp-rebalance-agent-bridge.js";
import {
  CommerceApplicationService,
  USER_COMMERCE_JOB_LIFETIME_SECONDS,
  WalletAuthenticationService,
} from "./commerce.js";
import {
  SellerAuthorizationGuard,
  ViemErc8004OwnershipReader,
} from "./seller-ownership.js";
import { ServicePublicationVerifier } from "./service-publication.js";
import { YieldOptimizerExecutionStore } from "./yield-optimizer-execution-store.js";
import { YieldFundedSessionRelease } from "./yield-funded-session-release.js";
import { GridFundedSessionRelease } from "./grid-funded-session-release.js";
import { GridTraderExecutionStore } from "./grid-trader-execution-store.js";
import { HealthGuardFundedSessionRelease } from "./health-guard-funded-session-release.js";
import { HealthGuardCycleStore } from "./health-guard-cycle-store.js";
import { HealthGuardPreflight } from "./health-guard-preflight.js";
import { parseHealthGuardPoolRegistry } from "./health-guard-pool-registry.js";
import { commerceNetworkConfig } from "./commerce-network-config.js";

class EmptyAgentRepository implements AgentReadRepository {
  public async list() {
    return Promise.resolve({ items: [], nextCursor: null });
  }
  public async findById() {
    return Promise.resolve(null);
  }
}

const environment = getServerEnvironment();
const commerceNetworks = commerceNetworkConfig(environment);
const healthGuardPools = parseHealthGuardPoolRegistry(environment.HEALTH_GUARD_POOLS_JSON);
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
  registryAddresses: {
    ...(commerceNetworks[56] === undefined
      ? {}
      : { 56: commerceNetworks[56].erc8004Registry }),
    ...(commerceNetworks[97] === undefined
      ? {}
      : { 97: commerceNetworks[97].erc8004Registry }),
  },
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
const healthGuardPreflight =
  healthGuardPools === undefined
    ? undefined
    : new HealthGuardPreflight({
        rpcUrl: environment.BSC_MAINNET_RPC_URL,
        pools: healthGuardPools,
      });
const altanaSessions =
  connection === null || mandates === undefined || environment.ALTANA_SESSION_ENCRYPTION_KEY === undefined
    ? undefined
    : new AltanaSessionAuthorizationService(
        mandates,
        new DrizzleAltanaSessionAuthorizationStore(connection.db),
        new AltanaSessionEncryption(environment.ALTANA_SESSION_ENCRYPTION_KEY),
        environment.BSC_TESTNET_RPC_URL,
        environment.VENUS_TESTNET_USDT === undefined || environment.VENUS_TESTNET_USDT_VTOKEN === undefined || environment.VENUS_TESTNET_USDT_DECIMALS === undefined || environment.MAX_JOB_AMOUNT_BASE_UNITS === undefined
          ? undefined
          : {
              usdt: environment.VENUS_TESTNET_USDT as `0x${string}`,
              venusUsdtVToken: environment.VENUS_TESTNET_USDT_VTOKEN as `0x${string}`,
              maximumJobAmountBaseUnits: BigInt(environment.MAX_JOB_AMOUNT_BASE_UNITS),
            },
        environment.GRID_TESTNET_USDT === undefined || environment.GRID_TESTNET_WBNB === undefined || environment.GRID_TESTNET_SWAP_ROUTER === undefined || environment.GRID_TESTNET_USDT_DECIMALS === undefined || environment.MAX_GRID_JOB_AMOUNT_BASE_UNITS === undefined
          ? undefined
          : {
              usdt: environment.GRID_TESTNET_USDT as `0x${string}`,
              wrappedBnb: environment.GRID_TESTNET_WBNB as `0x${string}`,
              swapRouter: environment.GRID_TESTNET_SWAP_ROUTER as `0x${string}`,
              usdtDecimals: Number(environment.GRID_TESTNET_USDT_DECIMALS),
              maximumJobAmountBaseUnits: BigInt(environment.MAX_GRID_JOB_AMOUNT_BASE_UNITS),
            },
        environment.BSC_MAINNET_RPC_URL,
        healthGuardPools === undefined || healthGuardPreflight === undefined
          ? undefined
          : { pools: healthGuardPools },
        healthGuardPreflight,
      );
const kernelSessions =
  connection === null || mandates === undefined || environment.ALTANA_SESSION_ENCRYPTION_KEY === undefined ||
  environment.RELIC_KERNEL_SESSIONS_ENABLED !== "true" || environment.ZERODEV_RPC_URL === undefined
    ? undefined
    : new KernelSessionAuthorizationService(
    mandates,
    new DrizzleKernelSessionAuthorizationStore(connection.db),
    new AltanaSessionEncryption(environment.ALTANA_SESSION_ENCRYPTION_KEY),
    environment.GRID_TESTNET_USDT === undefined || environment.GRID_TESTNET_WBNB === undefined || environment.GRID_TESTNET_SWAP_ROUTER === undefined || environment.GRID_TESTNET_POOL_FEE === undefined
      ? undefined
      : {
          usdt: environment.GRID_TESTNET_USDT as `0x${string}`,
          wrappedBnb: environment.GRID_TESTNET_WBNB as `0x${string}`,
          swapRouter: environment.GRID_TESTNET_SWAP_ROUTER as `0x${string}`,
          fee: Number(environment.GRID_TESTNET_POOL_FEE),
        },
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
        environment.ALTANA_SESSION_ENCRYPTION_KEY === undefined
          ? undefined
          : new PancakeLpRebalanceExecutor(
              new DrizzleAltanaSessionAuthorizationStore(connection.db),
              new AltanaSessionEncryption(environment.ALTANA_SESSION_ENCRYPTION_KEY),
              environment.BSC_TESTNET_RPC_URL,
            ),
      );
const walletAuth =
  connection === null
    ? undefined
    : new WalletAuthenticationService(
        new DrizzleWalletAuthStore(connection.db),
        environment.RELIC_WALLET_AUTH_DOMAIN ?? "localhost",
        environment.RELIC_WALLET_AUTH_URI ?? "http://localhost:3000",
      );
const commerceEip712DomainAddress =
  environment.RELIC_COMMERCE_EIP712_DOMAIN_ADDRESS ??
  (environment.NODE_ENV === "production"
    ? undefined
    : environment.ERC8183_POLICY_ADDRESS);
if (
  connection !== null &&
  environment.NODE_ENV === "production" &&
  (environment.RELIC_WALLET_AUTH_DOMAIN === undefined ||
    environment.RELIC_WALLET_AUTH_URI === undefined ||
    commerceEip712DomainAddress === undefined ||
    environment.RELIC_ERC8183_COMMERCE_ADDRESS === undefined ||
    environment.RELIC_ERC8183_EVALUATOR_ADDRESS === undefined)
)
  throw new Error(
    "Production commerce requires wallet-auth, an EIP-712 domain address, ERC-8183 commerce, and evaluator configuration",
  );
const commerce =
  connection === null || commerceEip712DomainAddress === undefined
    ? undefined
    : new CommerceApplicationService(
        new DrizzleCommerceStore(connection.db),
        commerceEip712DomainAddress as `0x${string}`,
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
        new ServicePublicationVerifier(new DrizzleSupplyStore(connection.db)),
        commerceNetworks,
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
  ...(connection === null || executions === undefined || environment.RELIC_LP_REBALANCER_INTERNAL_TOKEN === undefined
    ? {}
    : {
        lpRebalanceAgentBridge: new LpRebalanceAgentBridge(
          new DrizzleCommerceStore(connection.db),
          executions,
        ),
        lpRebalanceInternalToken: environment.RELIC_LP_REBALANCER_INTERNAL_TOKEN,
      }),
  ...(connection === null || environment.RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN === undefined || environment.RELIC_YIELD_OPTIMIZER_AGENT_ID === undefined
    ? {}
    : {
        yieldOptimizerExecutionStore: new YieldOptimizerExecutionStore(
          new DrizzleAgentExecutionJobStore(connection.db),
          environment.RELIC_YIELD_OPTIMIZER_AGENT_ID,
        ),
        yieldOptimizerInternalToken: environment.RELIC_YIELD_OPTIMIZER_INTERNAL_TOKEN,
        ...(environment.ALTANA_SESSION_ENCRYPTION_KEY === undefined || environment.RELIC_YIELD_SESSION_TRANSFER_PUBLIC_KEY === undefined ? {} : { yieldFundedSessionRelease: new YieldFundedSessionRelease(new DrizzleCommerceStore(connection.db), new AltanaSessionEncryption(environment.ALTANA_SESSION_ENCRYPTION_KEY), environment.RELIC_YIELD_OPTIMIZER_AGENT_ID, environment.RELIC_YIELD_SESSION_TRANSFER_PUBLIC_KEY) }),
      }),
  ...(connection === null || environment.RELIC_GRID_TRADER_INTERNAL_TOKEN === undefined || environment.RELIC_GRID_TRADER_AGENT_ID === undefined
    ? {}
    : {
        gridTraderInternalToken: environment.RELIC_GRID_TRADER_INTERNAL_TOKEN,
        gridTraderExecutionStore: new GridTraderExecutionStore(new DrizzleAgentExecutionJobStore(connection.db), environment.RELIC_GRID_TRADER_AGENT_ID),
        ...(environment.ALTANA_SESSION_ENCRYPTION_KEY === undefined || environment.RELIC_GRID_SESSION_TRANSFER_PUBLIC_KEY === undefined
          ? {}
          : {
              gridFundedSessionRelease: new GridFundedSessionRelease(
                new DrizzleCommerceStore(connection.db),
                new AltanaSessionEncryption(environment.ALTANA_SESSION_ENCRYPTION_KEY),
                environment.RELIC_GRID_TRADER_AGENT_ID,
                environment.RELIC_GRID_SESSION_TRANSFER_PUBLIC_KEY,
              ),
            }),
      }),
  ...(healthGuardPreflight === undefined ? {} : { healthGuardPreflight }),
  ...(connection === null || environment.RELIC_HEALTH_GUARD_INTERNAL_TOKEN === undefined || environment.RELIC_HEALTH_GUARD_AGENT_ID === undefined
    ? {}
    : {
        healthGuardInternalToken: environment.RELIC_HEALTH_GUARD_INTERNAL_TOKEN,
        healthGuardCycleStore: new HealthGuardCycleStore(
          new DrizzleHealthGuardCycleStore(connection.db),
          environment.RELIC_HEALTH_GUARD_AGENT_ID,
        ),
        ...(environment.ALTANA_SESSION_ENCRYPTION_KEY === undefined || environment.RELIC_HEALTH_GUARD_SESSION_TRANSFER_PUBLIC_KEY === undefined || healthGuardPools === undefined
          ? {}
          : { healthGuardFundedSessionRelease: new HealthGuardFundedSessionRelease(new DrizzleCommerceStore(connection.db), new AltanaSessionEncryption(environment.ALTANA_SESSION_ENCRYPTION_KEY), environment.RELIC_HEALTH_GUARD_AGENT_ID, environment.RELIC_HEALTH_GUARD_SESSION_TRANSFER_PUBLIC_KEY, healthGuardPools) }),
      }),
  ...(walletAuth === undefined ? {} : { walletAuthService: walletAuth }),
  ...(environment.NEXT_PUBLIC_PRIVY_APP_ID === undefined
    ? {}
    : { privyAppId: environment.NEXT_PUBLIC_PRIVY_APP_ID }),
  ...(environment.PRIVY_JWT_VERIFICATION_KEY === undefined
    ? {}
    : { privyJwtVerificationKey: environment.PRIVY_JWT_VERIFICATION_KEY }),
  ...(commerce === undefined ? {} : { commerceService: commerce }),
  ...(altanaSessions === undefined ? {} : { altanaSessionService: altanaSessions }),
  ...(kernelSessions === undefined ? {} : { kernelSessionService: kernelSessions }),
  ownershipReader,
  ...(sellerAuthorization === undefined
    ? {}
    : { sellerAuthorizationGuard: sellerAuthorization }),
  publicOrigin: environment.RELIC_PUBLIC_ORIGIN ?? "http://localhost:3000",
  environmentName: environment.NODE_ENV,
  ...(environment.RELIC_ADMIN_PRINCIPAL_IDS === undefined
    ? {}
    : {
        adminPrincipalIds: environment.RELIC_ADMIN_PRINCIPAL_IDS.split(",").map(
          (principalId) => principalId.trim(),
        ),
      }),
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
