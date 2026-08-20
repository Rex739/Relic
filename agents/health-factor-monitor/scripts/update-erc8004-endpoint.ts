import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentURIGenerator, ERC8004Agent } from "@bnbagent/sdk/erc8004";
import {
  EVMWalletProvider,
  LocalExecutor,
  type ExecutionContext,
  type IntentExecutor,
} from "@bnbagent/sdk/wallets";
import { getAddress } from "viem";

import { replaceSingleEndpoint } from "../src/erc8004-metadata-update.js";
import { loadLocalEnvironment } from "../src/local-env.js";

const AGENT_ID = 1840;
const CHAIN_ID = 97;
const NETWORK = "bsc-testnet";
const REGISTRY = getAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e");
const WALLET_ADDRESS = getAddress("0x323F064B777745703Fa8eB56109A763503AeE4Dd");
const OLD_ENDPOINT =
  "https://minor-disclaimers-allows-fireplace.trycloudflare.com/erc8183";
const NEW_ENDPOINT = "https://p01--relic--b28z25yb24gx.code.run/erc8183";

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(agentRoot, "../..");
loadLocalEnvironment(repositoryRoot);
loadLocalEnvironment(agentRoot);

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const flag = (name: string) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const execute = process.argv.includes("--execute");
if (process.env.PRIVATE_KEY)
  throw new Error("PRIVATE_KEY is forbidden for the ERC-8004 endpoint update");
if (process.env.NETWORK && process.env.NETWORK !== NETWORK)
  throw new Error("Refusing to update ERC-8004 outside BSC Testnet");

process.env.RPC_URL_BSC_TESTNET = required("BSC_TESTNET_RPC_URL");
process.env.BNBAGENT_USE_PAYMASTER = "1";
process.env.ERC8004_REGISTRY_ADDRESS = REGISTRY;

class SponsorshipOnlyWalletProvider extends EVMWalletProvider {
  public override makeExecutor(context: ExecutionContext): IntentExecutor {
    if (!context.paymaster)
      throw new Error("STOP: BSC Testnet paymaster is unavailable");
    const guardedClient = new Proxy(context.client, {
      get(target, property): unknown {
        if (property === "sendRawTransaction")
          return () =>
            Promise.reject(
              new Error(
                "STOP: direct self-pay broadcast is forbidden for this update",
              ),
            );
        if (property === "request")
          return (...args: unknown[]) => {
            const request = args[0] as { method?: unknown } | undefined;
            if (request?.method === "eth_sendRawTransaction")
              return Promise.reject(
                new Error(
                  "STOP: direct self-pay RPC broadcast is forbidden for this update",
                ),
              );
            const requestMethod = target.request.bind(target) as unknown as (
              ...values: unknown[]
            ) => unknown;
            return requestMethod(...args);
          };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function"
          ? (...args: unknown[]) =>
              Reflect.apply(value, target, args) as unknown
          : value;
      },
    });
    return new LocalExecutor({
      client: guardedClient,
      paymaster: context.paymaster,
      selfPayFallback: false,
      walletProvider: this,
      ...(context.fallbackRpcUrls === undefined
        ? {}
        : { fallbackRpcUrls: context.fallbackRpcUrls }),
      ...(context.receiptTimeout === undefined
        ? {}
        : { receiptTimeout: context.receiptTimeout }),
      ...(context.relayUnseenTimeout === undefined
        ? {}
        : { relayUnseenTimeout: context.relayUnseenTimeout }),
    });
  }
}

const password = required("WALLET_PASSWORD");
const wallet = new SponsorshipOnlyWalletProvider({
  address: WALLET_ADDRESS,
  password,
  walletsDir: join(agentRoot, ".studio", "wallets"),
});
delete process.env.WALLET_PASSWORD;
if (wallet.source !== "loaded_keystore" || !wallet.exists())
  throw new Error("Existing encrypted seller keystore was not loaded");
if (getAddress(wallet.address) !== WALLET_ADDRESS)
  throw new Error("Encrypted seller wallet address mismatch");

const sdk = await ERC8004Agent.create({
  network: NETWORK,
  walletProvider: wallet,
});
if (sdk.network.chainId !== CHAIN_ID || sdk.network.name !== NETWORK)
  throw new Error("Refusing non-testnet ERC-8004 network");
if (getAddress(sdk.contractAddress) !== REGISTRY)
  throw new Error("Unexpected BSC Testnet ERC-8004 registry");

const current = await sdk.getAgentInfo(AGENT_ID);
if (getAddress(current.owner) !== WALLET_ADDRESS)
  throw new Error("Configured wallet no longer owns ERC-8004 agent 1840");
if (getAddress(current.agentWallet) !== WALLET_ADDRESS)
  throw new Error("Configured wallet is no longer agent 1840's agent wallet");
const currentMetadata = await ERC8004Agent.parseAgentUri(current.agentURI);
if (!currentMetadata)
  throw new Error("Current ERC-8004 metadata is unreadable");

const replacement = replaceSingleEndpoint(
  currentMetadata,
  OLD_ENDPOINT,
  NEW_ENDPOINT,
);
const newAgentUri = `data:application/json;base64,${AgentURIGenerator.encodeRegistrationFileToBase64(
  replacement.metadata,
)}`;
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const currentUriSha256 = sha256(current.agentURI);
const newUriSha256 = sha256(newAgentUri);

const requiredHealthPaths = ["/health", "/ready", "/erc8183/health"];
const health: Record<string, { status: number }> = {};
for (const path of requiredHealthPaths) {
  const response = await fetch(
    `https://p01--relic--b28z25yb24gx.code.run${path}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (response.status !== 200)
    throw new Error(`Northflank ${path} returned HTTP ${response.status}`);
  health[path] = { status: response.status };
}

const preflight = {
  event: "erc8004_endpoint_update_preflight",
  mode: execute ? "execute" : "preview",
  network: NETWORK,
  chainId: CHAIN_ID,
  agentId: AGENT_ID,
  owner: current.owner,
  agentWallet: current.agentWallet,
  metadataDiff: {
    path: replacement.path,
    old: OLD_ENDPOINT,
    new: NEW_ENDPOINT,
  },
  preservedTopLevelFields: Object.keys(currentMetadata),
  currentUriSha256,
  newUriSha256,
  health,
  transaction: {
    from: wallet.address,
    to: REGISTRY,
    function: "setAgentURI(uint256,string)",
    args: [AGENT_ID, newAgentUri],
    value: "0",
    broadcast: "MegaFuel BSC Testnet paymaster only; direct self-pay blocked",
  },
};
process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
if (!execute) process.exit(0);

const expectedCurrentSha256 = flag("expected-current-sha256");
if (!expectedCurrentSha256 || expectedCurrentSha256 !== currentUriSha256)
  throw new Error("Current metadata hash changed or was not explicitly pinned");

const evidencePath = join(
  agentRoot,
  ".agent-data",
  "erc8004-agent-1840-endpoint-update.json",
);
const registrationEvidencePath = join(
  agentRoot,
  ".agent-data",
  "phase05-erc8004-registration.json",
);
const persist = (path: string, value: unknown) => {
  const temporary = `${path}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify(
      value,
      (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(temporary, path);
};

const startedAt = new Date().toISOString();
persist(evidencePath, {
  kind: "real_onchain",
  status: "prepared",
  startedAt,
  ...preflight,
  previousAgentUri: current.agentURI,
  nextAgentUri: newAgentUri,
});

try {
  const result = await sdk.setAgentUri(AGENT_ID, newAgentUri);
  const readBack = await sdk.getAgentInfo(AGENT_ID);
  if (readBack.agentURI !== newAgentUri)
    throw new Error("Confirmed transaction did not persist the expected URI");
  const receipt = result.receipt;
  const transactionEvidence = {
    transactionHash: result.transactionHash,
    blockNumber: receipt?.blockNumber ?? null,
    blockHash: receipt?.blockHash ?? null,
    status: receipt?.status ?? null,
    gasUsed: receipt?.gasUsed ?? null,
    effectiveGasPrice: receipt?.effectiveGasPrice ?? null,
  };
  persist(evidencePath, {
    kind: "real_onchain",
    status: "confirmed",
    startedAt,
    confirmedAt: new Date().toISOString(),
    ...preflight,
    previousAgentUri: current.agentURI,
    nextAgentUri: newAgentUri,
    transaction: transactionEvidence,
    readBack: {
      owner: readBack.owner,
      agentWallet: readBack.agentWallet,
      agentUriSha256: sha256(readBack.agentURI),
      matches: readBack.agentURI === newAgentUri,
    },
  });

  const registrationEvidence = JSON.parse(
    readFileSync(registrationEvidencePath, "utf8"),
  ) as Record<string, unknown>;
  const endpointHistory = Array.isArray(registrationEvidence.endpoint_history)
    ? registrationEvidence.endpoint_history
    : [];
  endpointHistory.push({
    endpoint: registrationEvidence.endpoint,
    agent_uri: current.agentURI,
    uri_update: registrationEvidence.uri_update,
    replaced_at: new Date().toISOString(),
  });
  registrationEvidence.endpoint_history = endpointHistory;
  registrationEvidence.endpoint = NEW_ENDPOINT;
  registrationEvidence.final_agent_uri = newAgentUri;
  registrationEvidence.uri_update = {
    transaction_hash: transactionEvidence.transactionHash,
    block_number: transactionEvidence.blockNumber,
    block_hash: transactionEvidence.blockHash,
    status: transactionEvidence.status,
    gas_used: transactionEvidence.gasUsed,
    effective_gas_price: transactionEvidence.effectiveGasPrice,
  };
  registrationEvidence.completed = true;
  registrationEvidence.completed_at = new Date().toISOString();
  persist(registrationEvidencePath, registrationEvidence);

  process.stdout.write(
    `${JSON.stringify(
      {
        event: "erc8004_endpoint_update_confirmed",
        network: NETWORK,
        chainId: CHAIN_ID,
        agentId: AGENT_ID,
        endpoint: NEW_ENDPOINT,
        newUriSha256,
        ...transactionEvidence,
        readBackMatches: true,
      },
      (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      2,
    )}\n`,
  );
} catch (error) {
  const transactionHash =
    error !== null &&
    typeof error === "object" &&
    "txHash" in error &&
    typeof error.txHash === "string"
      ? error.txHash
      : null;
  persist(evidencePath, {
    kind: "real_onchain",
    status: transactionHash === null ? "failed_prebroadcast" : "pending",
    startedAt,
    observedAt: new Date().toISOString(),
    ...preflight,
    previousAgentUri: current.agentURI,
    nextAgentUri: newAgentUri,
    transactionHash,
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
