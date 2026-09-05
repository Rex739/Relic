"use client";

import { Landmark, LogOut, PackagePlus, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { readJsonResponse } from "../../lib/http-json";
import { Button, buttonVariants } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useRelicWallet } from "./relic-wallet-provider";
import { switchWalletChain, walletChainId } from "./wallet-provider";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.09-1.93 3.25-4.77 3.25-8.1Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.31-2.65l-3.57-2.77c-.98.66-2.24 1.05-3.74 1.05-2.87 0-5.3-1.94-6.17-4.54H2.15V16.9A11 11 0 0 0 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.83 14.09A6.6 6.6 0 0 1 5.46 12c0-.73.13-1.43.37-2.09V7.1H2.15A11 11 0 0 0 1 12c0 1.77.43 3.44 1.15 4.9l3.68-2.81Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.37c1.62 0 3.07.56 4.22 1.66l3.16-3.16C17.45 2.07 14.96 1 12 1A11 11 0 0 0 2.15 7.1l3.68 2.81C6.7 7.31 9.13 5.37 12 5.37Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function WalletSession({
  connectLabel = "Connect",
  showRegisterAgent = false,
}: {
  connectLabel?: string;
  showRegisterAgent?: boolean;
}) {
  const wallet = useRelicWallet();
  const router = useRouter();
  const pathname = usePathname();
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  const connectRequested = useRef(
    typeof window !== "undefined" &&
      window.sessionStorage.getItem("wallet_connect_requested") === "1",
  );
  const connectMethod = useRef<"google" | "email" | "wallet" | null>(
    typeof window === "undefined"
      ? null
      : (window.sessionStorage.getItem("wallet_connect_method") as
          "google" | "email" | "wallet" | null),
  );

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.get("connect") !== "1") return;
    const next = parameters.get("next");
    if (
      next !== null &&
      next.startsWith("/agents/") &&
      next.includes("/hire")
    )
      window.sessionStorage.setItem("relic_post_connect_path", next);
    parameters.delete("connect");
    parameters.delete("next");
    const query = parameters.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${query === "" ? "" : `?${query}`}`,
    );
    setConnectOpen(true);
  }, [pathname]);

  useEffect(() => {
    const openConnect = (event: Event) => {
      const detail = (event as CustomEvent<{ returnTo?: unknown }>).detail;
      const returnTo = detail?.returnTo;
      if (
        typeof returnTo === "string" &&
        returnTo.startsWith("/agents/") &&
        returnTo.includes("/hire")
      )
        window.sessionStorage.setItem("relic_post_connect_path", returnTo);
      setConnectOpen(true);
    };
    window.addEventListener("relic:open-connect", openConnect);
    return () => window.removeEventListener("relic:open-connect", openConnect);
  }, []);

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

  const clearConnectionRequest = () => {
    connectRequested.current = false;
    connectMethod.current = null;
    window.sessionStorage.removeItem("wallet_connect_requested");
    window.sessionStorage.removeItem("wallet_connect_method");
  };

  const continueAfterAuthentication = () => {
    const next = window.sessionStorage.getItem("relic_post_connect_path");
    window.sessionStorage.removeItem("relic_post_connect_path");
    if (next !== null) {
      router.replace(next);
      return;
    }
    router.refresh();
  };

  const activeWalletDetails = async () => {
    const provider = await wallet.getProvider();
    const accounts = (await provider.request({ method: "eth_accounts" })) as
      string[] | undefined;
    const walletAddress = accounts?.[0];
    if (walletAddress === undefined)
      throw new Error("No wallet account selected");
    await switchWalletChain(provider, 97);
    const connectedChainId = await walletChainId(provider);
    if (connectedChainId !== 97)
      throw new Error("Relic requires BSC Testnet while it is in development");
    return { walletAddress, connectedChainId, provider };
  };

  const authenticateWalletSession = async () => {
    try {
      const { walletAddress, connectedChainId, provider } =
        await activeWalletDetails();
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
      continueAfterAuthentication();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Wallet connection failed",
      );
    } finally {
      clearConnectionRequest();
      setBusy(false);
    }
  };

  const authenticateGoogleSession = async () => {
    try {
      if (wallet.identityToken === null)
        throw new Error("Google sign-in is still finishing. Please try again.");
      const { walletAddress, connectedChainId } = await activeWalletDetails();
      const response = await fetch("/api/auth/privy/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identityToken: wallet.identityToken,
          address: walletAddress,
          chainId: connectedChainId,
        }),
      });
      const verified = await readJsonResponse<{
        walletAddress?: string;
        error?: string;
      }>(response);
      if (
        verified === null ||
        !response.ok ||
        verified.walletAddress === undefined
      )
        throw new Error(verified?.error ?? "Google sign-in was not accepted");
      setAddress(verified.walletAddress);
      setChainId(connectedChainId);
      continueAfterAuthentication();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Google sign-in failed",
      );
    } finally {
      clearConnectionRequest();
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!connectRequested.current || !wallet.ready || !wallet.authenticated)
      return;
    if (wallet.address === null) return;
    if (
      connectMethod.current === "google" ||
      connectMethod.current === "email"
    ) {
      if (wallet.identityToken === null) return;
      void authenticateGoogleSession();
      return;
    }
    void authenticateWalletSession();
  }, [
    wallet.address,
    wallet.authenticated,
    wallet.identityToken,
    wallet.ready,
  ]);

  useEffect(() => {
    if (!connectRequested.current || wallet.loginError === null) return;
    clearConnectionRequest();
    setBusy(false);
    setError(wallet.loginError);
  }, [wallet.loginError]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOnOutsideInteraction = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node))
        setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  const connect = (method: "google" | "email" | "wallet") => {
    if (!wallet.configured) {
      setError(
        "Sign-in is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID first.",
      );
      return;
    }
    connectRequested.current = true;
    connectMethod.current = method;
    window.sessionStorage.setItem("wallet_connect_requested", "1");
    window.sessionStorage.setItem("wallet_connect_method", method);
    setBusy(true);
    setError(null);
    setConnectOpen(false);
    if (wallet.authenticated && wallet.address !== null) {
      if (method === "google") {
        // A previous wallet login can leave a valid Privy session behind even
        // when Relic has no local session. Link Google first instead of
        // mistaking that wallet identity for a completed Google login.
        if (wallet.profile?.isGoogleUser) void authenticateGoogleSession();
        else wallet.loginWithGoogle();
      } else void authenticateWalletSession();
      return;
    }
    if (method === "email") {
      wallet.loginWithEmail();
      return;
    }
    if (method === "google") {
      wallet.loginWithGoogle();
      return;
    }
    wallet.login();
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await wallet.logout();
    clearConnectionRequest();
    setAddress(null);
    setChainId(null);
    window.location.reload();
  };

  return (
    <div className="wallet-session">
      {address === null ? (
        <>
          {showRegisterAgent ? (
            <Button
              className="header-register-agent"
              disabled={busy || wallet.loginPending}
              onClick={() => setConnectOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <span className="register-agent-full">Register agent</span>
              <span className="register-agent-short">Register</span>
            </Button>
          ) : null}
          <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
            <Button
              className="header-connect"
              disabled={busy || wallet.loginPending}
              onClick={() => setConnectOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              {busy || wallet.loginPending
                ? "Connecting securely…"
                : connectLabel}
            </Button>
            <DialogContent className="connect-dialog-content">
              <DialogHeader>
                <DialogTitle>Connect to Relic</DialogTitle>
                <DialogDescription>
                  Choose how you&apos;d like to connect.
                </DialogDescription>
              </DialogHeader>
              <div className="connect-options">
                <Button
                  className="connect-option connect-option-google"
                  onClick={() => connect("google")}
                >
                  <span className="connect-option-icon google-icon">
                    <GoogleIcon />
                  </span>
                  <strong>Continue with Google</strong>
                </Button>
                <Button
                  className="connect-option"
                  onClick={() => connect("email")}
                  type="button"
                  variant="outline"
                >
                  <strong>Continue with email</strong>
                </Button>
                <Button
                  className="connect-option"
                  variant="outline"
                  onClick={() => connect("wallet")}
                >
                  <span className="connect-option-icon">
                    <Wallet size={18} />
                  </span>
                  <strong>Connect a wallet</strong>
                </Button>
              </div>
              <p className="connect-dialog-legal">
                By connecting, you agree to our{" "}
                <Link href="/terms">Terms of Service</Link>.
              </p>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <>
          {showRegisterAgent ? (
            <Link
              className={`${buttonVariants({ size: "sm", variant: "outline" })} header-register-agent`}
                href="/account/mylistings/new"
            >
              <span className="register-agent-full">Register agent</span>
              <span className="register-agent-short">Register</span>
            </Link>
          ) : null}
          <details
            className="account-menu"
            open={accountMenuOpen}
            ref={accountMenuRef}
          >
            <summary
              aria-label="Open account menu"
              onClick={(event) => {
                event.preventDefault();
                setAccountMenuOpen((open) => !open);
              }}
            >
              {wallet.profile?.imageUrl === null || wallet.profile === null ? (
                <span
                  aria-hidden="true"
                  className={`account-avatar account-avatar-${wallet.profile?.avatarIndex ?? 0}`}
                >
                  {(wallet.profile?.name ?? address).slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <img
                  alt=""
                  className="account-avatar"
                  referrerPolicy="no-referrer"
                  src={wallet.profile.imageUrl}
                />
              )}
              <span className="account-menu-identity">
                <strong>
                  {wallet.profile?.name ??
                    `${address.slice(0, 6)}…${address.slice(-4)}`}
                </strong>
                <small>
                  {chainId === 97 ? "BSC Testnet" : "Connected wallet"}
                </small>
              </span>
            </summary>
            <div className="account-menu-panel">
              <div className="account-menu-wallet">
                <span>CONNECTED WALLET</span>
                <strong title={address}>
                  {address.slice(0, 6)}…{address.slice(-4)}
                </strong>
              </div>
              <Link href="/account" onClick={() => setAccountMenuOpen(false)}>
                <UserRound size={16} />
                Account
              </Link>
              <Link
                href="/account/mylistings"
                onClick={() => setAccountMenuOpen(false)}
              >
                <PackagePlus size={16} />
                <span>
                  My listings
                  <small>Agents you offer</small>
                </span>
              </Link>
              <Link href="/account/my-hires" onClick={() => setAccountMenuOpen(false)}>
                <Landmark size={16} />
                <span>
                  My orders
                  <small>Tasks and deliveries</small>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setAccountMenuOpen(false);
                  void logout();
                }}
              >
                <LogOut size={16} />
                Disconnect
              </button>
            </div>
          </details>
        </>
      )}
      {error === null ? null : <span role="alert">{error}</span>}
    </div>
  );
}
