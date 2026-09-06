"use client";

import { createClient, BNB_TESTNET, type Signer } from "@altananetwork/sdk";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";

import { signerFromConnectedWallet } from "../../lib/altana-injected-signer";
import { Button } from "../../components/ui/button";
import { useRelicWallet } from "./relic-wallet-provider";
import { switchWalletChain } from "./wallet-provider";

type Authorization = {
  sessionAddress: string;
  sessionPublicKey: string;
  expiresAt: string;
  permissions: {
    calls?: Array<{ to: string }>;
    spend?: Array<{ token: string; limit: string; period: "day" }>;
  };
};

const positionManager = "0x427bF5b37357632377eCbEC9de3626C71A5396c1" as const;
const swapRouter = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as const;
const wbnb = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
const testUsdt = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as const;

const erc20ApprovalAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function AltanaSessionAuthorization({
  mandateId,
  autoStart = true,
  onAuthorized,
}: {
  mandateId: string;
  autoStart?: boolean;
  onAuthorized: () => void | Promise<void>;
}) {
  const wallet = useRelicWallet();
  const [stage, setStage] = useState<"idle" | "preparing" | "signing" | "approving" | "verifying">("idle");
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);
  const busy = stage !== "idle";

  const authorize = async () => {
    if (!wallet.authenticated || wallet.address === null) {
      setError("Connect and authenticate the wallet that will hold this LP position.");
      return;
    }
    setError(null);
    setStage("preparing");
    try {
      const preparedResponse = await fetch(
        `/api/mandates/${encodeURIComponent(mandateId)}/altana-session-authorization`,
        { method: "POST" },
      );
      const prepared = (await preparedResponse.json()) as Authorization & { error?: string };
      if (!preparedResponse.ok || prepared.sessionPublicKey === undefined)
        throw new Error(prepared.error ?? "Could not prepare the trading permission.");

      const provider = await wallet.getProvider();
      await switchWalletChain(provider, 97);
      const adminSigner = await signerFromConnectedWallet(provider);
      const sessionSigner: Signer = {
        type: "privateKey",
        address: prepared.sessionAddress as Address,
        publicKey: prepared.sessionPublicKey as Hex,
        // The browser never receives the session private key. grantSession only
        // needs its public descriptor; this fail-closed method must never run.
        signDigest: async () => {
          throw new Error("The buyer session key remains encrypted on Relic.");
        },
      };
      const client = createClient({ chains: [BNB_TESTNET] });
      const altanaWallet = await client.createWallet({ signer: adminSigner });
      setStage("signing");
      const grant = await client.grantSession({
        wallet: altanaWallet,
        signer: adminSigner,
        sessionSigner,
        chainId: 97,
        permissions: {
          calls: (prepared.permissions.calls ?? []).map(({ to }) => ({ to: to as Address })),
          spend: (prepared.permissions.spend ?? []).map(({ token, limit, period }) => ({
            token: token as Address,
            limit: BigInt(limit),
            period,
          })),
        },
        expiry: Math.floor(Date.parse(prepared.expiresAt) / 1_000),
      });
      if (grant.transactionHash === undefined)
        throw new Error("Altana confirmed the grant without a transaction receipt. Try again shortly.");
      const spendLimit = new Map(
        (prepared.permissions.spend ?? []).map(({ token, limit }) => [token.toLowerCase(), BigInt(limit)]),
      );
      const wbnbLimit = spendLimit.get(wbnb.toLowerCase());
      const usdtLimit = spendLimit.get(testUsdt.toLowerCase());
      if (wbnbLimit === undefined || usdtLimit === undefined)
        throw new Error("Relic did not prepare both bounded asset permissions for this LP position.");
      setStage("approving");
      const approval = await client.execute({
        wallet: altanaWallet,
        signer: adminSigner,
        chainId: 97,
        calls: [
          { to: wbnb, data: approveData(positionManager, wbnbLimit) },
          { to: wbnb, data: approveData(swapRouter, wbnbLimit) },
          { to: testUsdt, data: approveData(positionManager, usdtLimit) },
          { to: testUsdt, data: approveData(swapRouter, usdtLimit) },
        ],
      });
      if (approval.status !== "CONFIRMED" || approval.transactionHash === undefined)
        throw new Error("PancakeSwap approvals were not confirmed. The LP session is not active yet.");
      setStage("verifying");
      const confirmedResponse = await fetch(
        `/api/mandates/${encodeURIComponent(mandateId)}/altana-session-authorization/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            walletAddress: grant.walletAddress,
            transactionHash: grant.transactionHash,
          }),
        },
      );
      const confirmed = (await confirmedResponse.json()) as { error?: string };
      if (!confirmedResponse.ok)
        throw new Error(confirmed.error ?? "Relic could not verify the trading permission.");
      await onAuthorized();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet authorization failed.");
    } finally {
      setStage("idle");
    }
  };

  useEffect(() => {
    if (!autoStart || attempted.current || !wallet.ready || !wallet.authenticated) return;
    attempted.current = true;
    void authorize();
  }, [autoStart, wallet.authenticated, wallet.ready]);

  return (
    <section className="authorization-action" aria-live="polite">
      <ShieldCheck aria-hidden="true" size={20} />
      <h3>Authorize your bounded trading session</h3>
      <p>
        Your wallet will grant one encrypted session key for this exact LP position,
        cap, contract allowlist, and expiry. Relic never receives your wallet private key.
      </p>
      <Button type="button" onClick={() => void authorize()} disabled={busy}>
        {busy ? <LoaderCircle className="button-loader" aria-hidden="true" /> : null}
        {stage === "preparing" ? "Preparing permission…" : stage === "signing" ? "Confirm session in wallet…" : stage === "approving" ? "Confirm bounded PancakeSwap approvals…" : stage === "verifying" ? "Verifying on-chain…" : "Authorize trading session"}
      </Button>
      {error === null ? null : <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

function approveData(spender: Address, amount: bigint) {
  return encodeFunctionData({
    abi: erc20ApprovalAbi,
    functionName: "approve",
    args: [spender, amount],
  });
}
