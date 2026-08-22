import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { EVMWalletProvider } from "@bnbagent/sdk/wallets";
import { getAddress } from "viem";

import { loadLocalEnvironment } from "../src/local-env.js";

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(agentRoot, "../..");
loadLocalEnvironment(repositoryRoot);
loadLocalEnvironment(agentRoot);

const OWNER = getAddress("0x323F064B777745703Fa8eB56109A763503AeE4Dd");
const AGENT_ID = "eef59aff-1922-41ce-8af5-ff02c9f31bb6";
const SERVICE_ID = "9437a3ef-562b-416e-beee-4244d269354f";
const API = "http://127.0.0.1:8787";

if (process.env.PRIVATE_KEY !== undefined)
  throw new Error("PRIVATE_KEY is forbidden");
const password = process.env.WALLET_PASSWORD?.trim();
if (!password) throw new Error("WALLET_PASSWORD is required");
const wallet = new EVMWalletProvider({
  address: OWNER,
  password,
  walletsDir: join(agentRoot, ".studio", "wallets"),
});
delete process.env.WALLET_PASSWORD;
if (wallet.source !== "loaded_keystore" || getAddress(wallet.address) !== OWNER)
  throw new Error("Existing encrypted seller wallet was not loaded");

const json = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || payload.data === undefined)
    throw new Error(
      payload.error?.message ?? `Relic API returned ${response.status}`,
    );
  return payload.data;
};

const existing = await json<
  Array<{
    id: string;
    status: string;
    version: { price: { amountBaseUnits: string }; capability: string };
  }>
>(await fetch(`${API}/v1/marketplace/agents/${AGENT_ID}/offers`));
const matched = existing.find(
  (offer) =>
    offer.status === "ACTIVE" &&
    offer.version.price.amountBaseUnits === "0" &&
    offer.version.capability === "Read-only Venus health-factor monitoring",
);
if (matched !== undefined) {
  process.stdout.write(
    `${JSON.stringify({ status: "already_active", offerId: matched.id, agentId: 1840, chainId: 97, fundsMoved: false, blockchainWrite: false })}\n`,
  );
  process.exit(0);
}

const challenge = await json<{ id: string; message: string }>(
  await fetch(`${API}/v1/auth/wallet/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: OWNER, chainId: 97 }),
  }),
);
const signed = await wallet.signMessage(challenge.message);
const session = await json<{
  sessionToken: string;
  principal: { walletAddress: string; chainId: number };
}>(
  await fetch(`${API}/v1/auth/wallet/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.id,
      address: OWNER,
      chainId: 97,
      signature: signed.signature,
    }),
  }),
);
if (
  getAddress(session.principal.walletAddress) !== OWNER ||
  session.principal.chainId !== 97
)
  throw new Error("Wallet-authenticated operator session mismatch");
const authorization = {
  authorization: `Bearer ${session.sessionToken}`,
  "content-type": "application/json",
};
const offer = await json<{ id: string; status: string }>(
  await fetch(`${API}/v1/operator/offers`, {
    method: "POST",
    headers: authorization,
    body: JSON.stringify({
      agentId: AGENT_ID,
      serviceId: SERVICE_ID,
      chainId: 97,
      capability: "Read-only Venus health-factor monitoring",
      billingModel: "PER_EXECUTION",
      price: {
        chainId: 97,
        tokenAddress: "0x0000000000000000000000000000000000000000",
        decimals: 18,
        amountBaseUnits: "0",
        symbol: "tBNB",
      },
      terms:
        "BSC Testnet read-only observation of a user-supplied public address through the independently verified Health Factor Monitor. The service may read Venus Core Pool account liquidity and entered markets. It cannot transfer tokens, submit transactions, hold funds, or act on Mainnet. A Relic mandate and distinct wallet authorization remain required. Price is zero base units per execution. Availability depends on current endpoint and verification evidence.",
      capabilitySnapshot: [
        "monitor_positions",
        "calculate_health_factor",
        "generate_alerts",
        "generate_recommendations",
      ],
      limitationsSnapshot: [
        "BSC Testnet only",
        "Read-only public-chain observations",
        "No transaction signing authority",
        "No custody or funds movement",
      ],
      effectiveAt: new Date().toISOString(),
      expiresAt: null,
    }),
  }),
);
const active = await json<{ id: string; status: string }>(
  await fetch(`${API}/v1/operator/offers/${offer.id}/activate`, {
    method: "POST",
    headers: { authorization: authorization.authorization },
  }),
);
process.stdout.write(
  `${JSON.stringify({ status: active.status, offerId: active.id, agentId: 1840, chainId: 97, operator: OWNER, amountBaseUnits: "0", token: "0x0000000000000000000000000000000000000000", fundsMoved: false, blockchainWrite: false })}\n`,
);
