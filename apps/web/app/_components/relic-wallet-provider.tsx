"use client";

import {
  PrivyProvider,
  useConnectWallet,
  usePrivy,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { bscTestnet } from "viem/chains";

import type { EthereumProvider } from "./wallet-provider";

type RelicWalletRuntime = {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  loginPending: boolean;
  loginError: string | null;
  login: () => void;
  logout: () => Promise<void>;
  getProvider: () => Promise<EthereumProvider>;
};

const unavailableRuntime: RelicWalletRuntime = {
  configured: false,
  ready: true,
  authenticated: false,
  address: null,
  loginPending: false,
  loginError: null,
  login: () => undefined,
  logout: () => Promise.resolve(),
  getProvider: () =>
    Promise.reject(
      new Error("Privy wallet authentication is not configured for this app"),
    ),
};

const RelicWalletContext =
  createContext<RelicWalletRuntime>(unavailableRuntime);

function selectWallet(
  wallets: ConnectedWallet[],
  authenticatedAddress: string | undefined,
) {
  if (authenticatedAddress !== undefined) {
    const matching = wallets.find(
      (wallet) =>
        wallet.address.toLowerCase() === authenticatedAddress.toLowerCase(),
    );
    if (matching !== undefined) return matching;
  }
  return wallets[0] ?? null;
}

function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready: privyReady, authenticated, user, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [selectedWalletAddress, setSelectedWalletAddress] = useState<
    string | undefined
  >(() =>
    typeof window === "undefined"
      ? undefined
      : (window.sessionStorage.getItem("relic_active_wallet") ?? undefined),
  );
  const [walletAwaitingAuthentication, setWalletAwaitingAuthentication] =
    useState<string | null>(null);
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      const address = wallet.address;
      window.sessionStorage.setItem("relic_active_wallet", address);
      setSelectedWalletAddress(address);
      setWalletAwaitingAuthentication(address);
    },
    onError: (error) => {
      setLoginPending(false);
      setLoginError(String(error));
    },
  });
  const activeWallet = selectWallet(
    wallets,
    selectedWalletAddress ?? user?.wallet?.address,
  );

  useEffect(() => {
    if (walletAwaitingAuthentication === null || !walletsReady) return;
    const selectedWallet = wallets.find(
      (wallet) =>
        wallet.address.toLowerCase() ===
        walletAwaitingAuthentication.toLowerCase(),
    );
    if (selectedWallet === undefined) return;
    setWalletAwaitingAuthentication(null);
    void selectedWallet
      .loginOrLink()
      .then(() => setLoginPending(false))
      .catch((error: unknown) => {
        setLoginPending(false);
        setLoginError(
          error instanceof Error
            ? error.message
            : "Privy could not authenticate the selected wallet",
        );
      });
  }, [walletAwaitingAuthentication, wallets, walletsReady]);

  const beginLogin = useCallback(() => {
    setLoginError(null);
    setLoginPending(true);
    connectWallet({
      description:
        "Choose the BSC Testnet buyer wallet you want to use with Relic.",
      walletChainType: "ethereum-only",
      walletList: [
        "wallet_connect_qr",
        "wallet_connect",
        "metamask",
        "detected_ethereum_wallets",
      ],
    });
  }, [connectWallet]);

  const disconnect = useCallback(async () => {
    setLoginPending(false);
    setLoginError(null);
    window.sessionStorage.removeItem("relic_active_wallet");
    setSelectedWalletAddress(undefined);
    setWalletAwaitingAuthentication(null);
    await logout();
  }, [logout]);

  const getProvider = useCallback(async () => {
    if (activeWallet === null)
      throw new Error("Connect a wallet through Privy first");
    return await activeWallet.getEthereumProvider();
  }, [activeWallet]);

  const value = useMemo<RelicWalletRuntime>(
    () => ({
      configured: true,
      ready: privyReady && walletsReady,
      authenticated: authenticated && !loginPending,
      address: activeWallet?.address ?? null,
      loginPending,
      loginError,
      login: beginLogin,
      logout: disconnect,
      getProvider,
    }),
    [
      activeWallet,
      authenticated,
      beginLogin,
      disconnect,
      getProvider,
      loginError,
      loginPending,
      privyReady,
      walletsReady,
    ],
  );

  return (
    <RelicWalletContext.Provider value={value}>
      {children}
    </RelicWalletContext.Provider>
  );
}

export function RelicWalletProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (appId === undefined || appId.trim() === "") {
    return (
      <RelicWalletContext.Provider value={unavailableRuntime}>
        {children}
      </RelicWalletContext.Provider>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      {...(process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID === undefined
        ? {}
        : { clientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID })}
      config={{
        loginMethods: ["wallet"],
        defaultChain: bscTestnet,
        supportedChains: [bscTestnet],
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
        appearance: {
          theme: "dark",
          accentColor: "#A9483F",
          walletChainType: "ethereum-only",
          walletList: [
            "metamask",
            "wallet_connect_qr",
            "wallet_connect",
            "detected_ethereum_wallets",
          ],
        },
      }}
    >
      <PrivyWalletBridge>{children}</PrivyWalletBridge>
    </PrivyProvider>
  );
}

export function useRelicWallet() {
  return useContext(RelicWalletContext);
}
