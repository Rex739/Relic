"use client";

import { useEffect, useRef, useState } from "react";

import { readJsonResponse } from "../../lib/http-json";
import { useRelicWallet } from "./relic-wallet-provider";
import { switchWalletChain, walletChainId } from "./wallet-provider";

export function WalletSession() {
  const wallet = useRelicWallet();
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectRequested = useRef(false);

  useEffect(() => {
    if (!wallet.ready) return;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as {
              walletAddress: string;
              chainId: number;
            })
          : null,
      )
      .then(async (session) => {
        if (session === null) return;
        if (!wallet.configured || !wallet.authenticated) {
          await fetch("/api/auth/logout", { method: "POST" });
          return;
        }
        const provider = await wallet.getProvider();
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as string[] | undefined;
        const activeChain = await walletChainId(provider);
        if (
          accounts?.[0]?.toLowerCase() !==
            session.walletAddress.toLowerCase() ||
          activeChain !== session.chainId
        ) {
          await fetch("/api/auth/logout", { method: "POST" });
          return;
        }
        setAddress(session.walletAddress);
        setChainId(session.chainId);
      })
      .catch(() => undefined);
  }, [
    wallet.authenticated,
    wallet.configured,
    wallet.getProvider,
    wallet.ready,
  ]);

  useEffect(() => {
    if (address === null || !wallet.authenticated) return;
    let provider: Awaited<ReturnType<typeof wallet.getProvider>> | null = null;
    const invalidate = () => {
      void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
        setAddress(null);
        setChainId(null);
        window.location.reload();
      });
    };
    void wallet.getProvider().then((connectedProvider) => {
      provider = connectedProvider;
      provider.on?.("accountsChanged", invalidate);
      provider.on?.("chainChanged", invalidate);
    });
    return () => {
      provider?.removeListener?.("accountsChanged", invalidate);
      provider?.removeListener?.("chainChanged", invalidate);
    };
  }, [address, wallet.authenticated, wallet.getProvider]);

  const authenticateRelicSession = async () => {
    try {
      const provider = await wallet.getProvider();
      const accounts = (await provider.request({ method: "eth_accounts" })) as
        string[] | undefined;
      const walletAddress = accounts?.[0];
      if (walletAddress === undefined)
        throw new Error("No wallet account selected");
      await switchWalletChain(provider, 97);
      const connectedChainId = await walletChainId(provider);
      if (connectedChainId !== 97)
        throw new Error("Relic buyer validation requires BSC Testnet");
      const challengeResponse = await fetch("/api/auth/wallet/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: walletAddress,
          chainId: connectedChainId,
        }),
      });
      const challenge = await readJsonResponse<{
        id?: string;
        message?: string;
        error?: string;
      }>(challengeResponse);
      if (
        challenge === null ||
        !challengeResponse.ok ||
        challenge.id === undefined ||
        challenge.message === undefined
      )
        throw new Error(challenge?.error ?? "Wallet challenge failed");
      const signature = (await provider.request({
        method: "personal_sign",
        params: [challenge.message, walletAddress],
      })) as string;
      const verifyResponse = await fetch("/api/auth/wallet/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.id,
          address: walletAddress,
          chainId: connectedChainId,
          signature,
        }),
      });
      const verified = await readJsonResponse<{
        walletAddress?: string;
        error?: string;
      }>(verifyResponse);
      if (
        verified === null ||
        !verifyResponse.ok ||
        verified.walletAddress === undefined
      )
        throw new Error(verified?.error ?? "Wallet signature was not accepted");
      setAddress(verified.walletAddress);
      setChainId(connectedChainId);
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Wallet connection failed",
      );
    } finally {
      connectRequested.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!connectRequested.current || !wallet.ready || !wallet.authenticated)
      return;
    if (wallet.address === null) return;
    void authenticateRelicSession();
  }, [wallet.address, wallet.authenticated, wallet.ready]);

  useEffect(() => {
    if (!connectRequested.current || wallet.loginError === null) return;
    connectRequested.current = false;
    setBusy(false);
    setError(wallet.loginError);
  }, [wallet.loginError]);

  const connect = () => {
    if (!wallet.configured) {
      setError(
        "Wallet login is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID first.",
      );
      return;
    }
    connectRequested.current = true;
    setBusy(true);
    setError(null);
    if (wallet.authenticated && wallet.address !== null) {
      void authenticateRelicSession();
      return;
    }
    wallet.login();
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await wallet.logout();
    setAddress(null);
    setChainId(null);
    window.location.reload();
  };

  return (
    <div className="wallet-session">
      {address === null ? (
        <button
          type="button"
          onClick={connect}
          disabled={busy || wallet.loginPending}
        >
          {busy || wallet.loginPending
            ? "Connecting securely…"
            : "Connect wallet"}
        </button>
      ) : (
        <div className="wallet-session-connected">
          <span title={address}>
            {address.slice(0, 6)}…{address.slice(-4)} ·{" "}
            {chainId === 97 ? "BSC Testnet" : "BSC Mainnet"}
          </span>
          <button type="button" onClick={() => void logout()}>
            Disconnect
          </button>
        </div>
      )}
      {error === null ? null : <span role="alert">{error}</span>}
    </div>
  );
}
