"use client";

import { useEffect, useState } from "react";

type EthereumProvider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function WalletSession() {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { walletAddress: string })
          : null,
      )
      .then((session) => setAddress(session?.walletAddress ?? null));
  }, []);

  const connect = async () => {
    if (window.ethereum === undefined) {
      setError("Install or open an EVM wallet to connect.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const chainHex = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;
      const walletAddress = accounts[0];
      if (walletAddress === undefined)
        throw new Error("No wallet account selected");
      const chainId = Number.parseInt(chainHex, 16);
      if (chainId !== 56 && chainId !== 97)
        throw new Error("Switch your wallet to BNB Chain or BNB Chain Testnet");
      const challengeResponse = await fetch("/api/auth/wallet/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: walletAddress, chainId }),
      });
      const challenge = (await challengeResponse.json()) as {
        id?: string;
        message?: string;
        error?: string;
      };
      if (
        !challengeResponse.ok ||
        challenge.id === undefined ||
        challenge.message === undefined
      )
        throw new Error(challenge.error ?? "Wallet challenge failed");
      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [challenge.message, walletAddress],
      })) as string;
      const verifyResponse = await fetch("/api/auth/wallet/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.id,
          address: walletAddress,
          chainId,
          signature,
        }),
      });
      const verified = (await verifyResponse.json()) as {
        walletAddress?: string;
        error?: string;
      };
      if (!verifyResponse.ok || verified.walletAddress === undefined)
        throw new Error(verified.error ?? "Wallet signature was not accepted");
      setAddress(verified.walletAddress);
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Wallet connection failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAddress(null);
    window.location.reload();
  };

  return (
    <div className="wallet-session">
      {address === null ? (
        <button type="button" onClick={() => void connect()} disabled={busy}>
          {busy ? "Check wallet…" : "Connect wallet"}
        </button>
      ) : (
        <button type="button" onClick={() => void logout()} title={address}>
          {address.slice(0, 6)}…{address.slice(-4)}
        </button>
      )}
      {error === null ? null : <span role="alert">{error}</span>}
    </div>
  );
}
