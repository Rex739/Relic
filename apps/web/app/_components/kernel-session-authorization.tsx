"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import {
  createKernelSessionApproval,
  createKernelOwnerAccount,
  type KernelSessionAuthorizationPlan,
} from "../../lib/zerodev-smart-account";
import { useRelicWallet } from "./relic-wallet-provider";
import { switchWalletChain } from "./wallet-provider";

type Prepared = KernelSessionAuthorizationPlan & { error?: string };

/**
 * MetaMask-compatible session approval. The wallet sees a typed-data request;
 * this component never asks for eth_sign, a raw digest, or a private key.
 */
export function KernelSessionAuthorization({ mandateId, onAuthorized, autoStart = true }: {
  mandateId: string;
  onAuthorized: () => void | Promise<void>;
  autoStart?: boolean;
}) {
  const wallet = useRelicWallet();
  const attempted = useRef(false);
  const [stage, setStage] = useState<"idle" | "preparing" | "signing" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  const authorize = async () => {
    if (!wallet.authenticated || wallet.address === null) {
      setError("Connect and authenticate the wallet that will own this smart account.");
      return;
    }
    const rpcUrl = process.env.NEXT_PUBLIC_ZERODEV_RPC_URL?.trim();
    if (rpcUrl === undefined || rpcUrl === "") {
      setError("Smart-account authorization is not configured for this environment.");
      return;
    }
    try {
      setError(null);
      const provider = await wallet.getProvider();
      // Grid Trader is still deliberately Testnet-only. The chain is fixed
      // here rather than accepted from user-controlled form data.
      await switchWalletChain(provider, 97);
      const owner = await createKernelOwnerAccount({ provider, chainId: 97, rpcUrl });
      setStage("preparing");
      const preparedResponse = await fetch(`/api/mandates/${encodeURIComponent(mandateId)}/kernel-session-authorization`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerAddress: owner.ownerAddress, smartAccountAddress: owner.smartAccountAddress }) });
      const prepared = await preparedResponse.json() as Prepared;
      if (!preparedResponse.ok || prepared.sessionAddress === undefined)
        throw new Error(prepared.error ?? "Could not prepare your smart-account permission.");
      await switchWalletChain(provider, prepared.chainId);
      setStage("signing");
      const approval = await createKernelSessionApproval({ provider, plan: prepared, rpcUrl });
      setStage("saving");
      const confirmedResponse = await fetch(`/api/mandates/${encodeURIComponent(mandateId)}/kernel-session-authorization/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(approval),
      });
      const confirmed = await confirmedResponse.json() as { error?: string };
      if (!confirmedResponse.ok) throw new Error(confirmed.error ?? "Could not store your smart-account permission.");
      await onAuthorized();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Smart-account authorization was not completed.");
      setStage("idle");
    }
  };

  useEffect(() => {
    if (autoStart && !attempted.current) {
      attempted.current = true;
      void authorize();
    }
  // Deliberately start once: wallet/provider changes require an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const busy = stage !== "idle";
  return <div className="altana-session-authorization">
    <div className="authorization-summary"><ShieldCheck size={18} /><div><strong>Bounded smart-account permission</strong><p>MetaMask will show a typed-data approval. It never exports your key or signs a raw digest.</p></div></div>
    {error === null ? null : <p className="form-error" role="alert">{error}</p>}
    <Button type="button" onClick={() => void authorize()} disabled={busy}>
      {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
      {stage === "preparing" ? "Preparing permission" : stage === "signing" ? "Approve in wallet" : stage === "saving" ? "Saving approval" : "Authorize smart account"}
    </Button>
  </div>;
}
