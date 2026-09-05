"use client";

import {
  PrivyProvider,
  useConnectWallet,
  useCreateWallet,
  useIdentityToken,
  useLogin,
  useLoginWithOAuth,
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
  useRef,
  useState,
  type ReactNode,
} from "react";
import { bscTestnet } from "viem/chains";

import type { EthereumProvider } from "./wallet-provider";

// Privy's fallback for BSC Testnet is Viem's BNB seed endpoint. That endpoint
// rejects browser-origin JSON-RPC requests, which prevents embedded wallets
// from simulating balances and approvals. Keep the standard chain metadata,
// but give every Relic checkout a CORS-enabled public RPC.
const relicBscTestnet = {
  ...bscTestnet,
  rpcUrls: {
    ...bscTestnet.rpcUrls,
    default: { http: ["https://bsc-testnet.publicnode.com"] },
    public: { http: ["https://bsc-testnet.publicnode.com"] },
  },
};

type RelicWalletRuntime = {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  profile: {
    name: string | null;
    email: string | null;
    imageUrl: string | null;
    isGoogleUser: boolean;
    avatarIndex: number;
  } | null;
  loginPending: boolean;
  loginError: string | null;
  identityToken: string | null;
  login: () => void;
  loginWithEmail: () => void;
  loginWithGoogle: () => void;
  logout: () => Promise<void>;
  getProvider: () => Promise<EthereumProvider>;
};

const unavailableRuntime: RelicWalletRuntime = {
  configured: false,
  ready: true,
  authenticated: false,
  address: null,
  profile: null,
  loginPending: false,
  loginError: null,
  identityToken: null,
  login: () => undefined,
  loginWithEmail: () => undefined,
  loginWithGoogle: () => undefined,
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
  preferEmbedded = false,
) {
  if (preferEmbedded) {
    return (
      wallets.find(
        (wallet) =>
          wallet.walletClientType === "privy" ||
          wallet.walletClientType === "privy-v2",
      ) ?? null
    );
  }
  if (authenticatedAddress !== undefined) {
    const matching = wallets.find(
      (wallet) =>
        wallet.address.toLowerCase() === authenticatedAddress.toLowerCase(),
    );
    if (matching !== undefined) return matching;
  }
  return wallets[0] ?? null;
}

function avatarIndex(seed: string | undefined) {
  if (seed === undefined || seed.length === 0) return 0;
  return (
    Array.from(seed).reduce(
      (total, character) => total + character.charCodeAt(0),
      0,
    ) % 10
  );
}

function googleProfileImage(user: ReturnType<typeof usePrivy>["user"]) {
  if (user?.google === undefined) return null;
  // Privy's stable user type does not promise a photo, but preserves it when
  // the configured Google provider makes one available.
  const profile = user.google as typeof user.google & {
    profilePictureUrl?: string | null;
    picture?: string | null;
  };
  return profile.profilePictureUrl ?? profile.picture ?? null;
}

function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready: privyReady, authenticated, user, logout } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { createWallet } = useCreateWallet();
  const { initOAuth } = useLoginWithOAuth();
  const { login: openPrivyLogin } = useLogin();
  const { ready: walletsReady, wallets } = useWallets();
  const [loginPending, setLoginPending] = useState(false);
  const [pendingLoginMethod, setPendingLoginMethod] = useState<
    "google" | "email" | "wallet" | null
  >(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [selectedWalletAddress, setSelectedWalletAddress] = useState<
    string | undefined
  >(() =>
    typeof window === "undefined"
      ? undefined
      : (window.sessionStorage.getItem("relic_active_wallet") ?? undefined),
  );
  const [selectedWalletSource, setSelectedWalletSource] = useState<
    "embedded" | "external" | undefined
  >(() =>
    typeof window === "undefined"
      ? undefined
      : (window.sessionStorage.getItem("relic_active_wallet_source") as
          | "embedded"
          | "external"
          | null) ?? undefined,
  );
  const [walletAwaitingAuthentication, setWalletAwaitingAuthentication] =
    useState<string | null>(null);
  const embeddedWalletCreationStarted = useRef(false);
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      const address = wallet.address;
      window.sessionStorage.setItem("relic_active_wallet", address);
      window.sessionStorage.setItem("relic_active_wallet_source", "external");
      setSelectedWalletAddress(address);
      setSelectedWalletSource("external");
      setWalletAwaitingAuthentication(address);
    },
    onError: (error) => {
      setLoginPending(false);
      setPendingLoginMethod(null);
      setLoginError(String(error));
    },
  });
  const activeWallet = selectWallet(
    wallets,
    selectedWalletAddress ?? user?.wallet?.address,
    (user?.google !== undefined || user?.email !== undefined) &&
      selectedWalletSource !== "external",
  );

  useEffect(() => {
    const hasEmbeddedWallet = wallets.some(
      (wallet) =>
        wallet.walletClientType === "privy" ||
        wallet.walletClientType === "privy-v2",
    );
    if (
      !authenticated ||
      (user?.google === undefined && user?.email === undefined) ||
      !walletsReady ||
      hasEmbeddedWallet ||
      embeddedWalletCreationStarted.current
    )
      return;
    embeddedWalletCreationStarted.current = true;
    void createWallet().catch((error: unknown) => {
      embeddedWalletCreationStarted.current = false;
      setLoginError(
        error instanceof Error
          ? error.message
          : "Relic could not create your embedded wallet",
      );
    });
  }, [authenticated, createWallet, user?.email, user?.google, wallets, walletsReady]);

  useEffect(() => {
    if (!loginPending || !authenticated || activeWallet === null) return;
    if (pendingLoginMethod === "google" && user?.google === undefined) return;
    if (pendingLoginMethod === "email" && user?.email === undefined) return;
    setLoginPending(false);
    setPendingLoginMethod(null);
  }, [
    activeWallet,
    authenticated,
    loginPending,
    pendingLoginMethod,
    user?.google,
  ]);

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
    setPendingLoginMethod("wallet");
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

  const beginGoogleLogin = useCallback(() => {
    setLoginError(null);
    setLoginPending(true);
    setPendingLoginMethod("google");
    window.sessionStorage.removeItem("relic_active_wallet");
    window.sessionStorage.removeItem("relic_active_wallet_source");
    setSelectedWalletAddress(undefined);
    setSelectedWalletSource("embedded");
    // Authentication may have been restored by Privy from a previously
    // connected external wallet. Choosing Google must start a Google session,
    // rather than linking Google to that unrelated wallet session.
    const startGoogleFlow = authenticated
      ? logout().then(() => initOAuth({ provider: "google" }))
      : initOAuth({ provider: "google" });
    void startGoogleFlow.catch((error: unknown) => {
      setLoginPending(false);
      setPendingLoginMethod(null);
      setLoginError(
        error instanceof Error
          ? error.message
          : "Could not start Google sign-in",
      );
    });
  }, [authenticated, initOAuth, logout]);

  const beginEmailLogin = useCallback(() => {
    setLoginError(null);
    setLoginPending(true);
    setPendingLoginMethod("email");
    window.sessionStorage.removeItem("relic_active_wallet");
    window.sessionStorage.removeItem("relic_active_wallet_source");
    setSelectedWalletAddress(undefined);
    setSelectedWalletSource("embedded");
    void Promise.resolve(openPrivyLogin({ loginMethods: ["email"] })).catch(
      (error: unknown) => {
        setLoginPending(false);
        setPendingLoginMethod(null);
        setLoginError(
          error instanceof Error ? error.message : "Could not start email sign-in",
        );
      },
    );
  }, [openPrivyLogin]);

  const disconnect = useCallback(async () => {
    setLoginPending(false);
    setPendingLoginMethod(null);
    setLoginError(null);
    window.sessionStorage.removeItem("relic_active_wallet");
    window.sessionStorage.removeItem("relic_active_wallet_source");
    setSelectedWalletAddress(undefined);
    setSelectedWalletSource(undefined);
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
      profile:
        user === null
          ? null
          : {
              name: user.google?.name ?? null,
              email: user.google?.email ?? user.email?.address ?? null,
              imageUrl: googleProfileImage(user),
              isGoogleUser: user.google !== undefined,
              avatarIndex: avatarIndex(
                user.google?.subject ?? activeWallet?.address ?? user.id,
              ),
            },
      loginPending,
      loginError,
      identityToken,
      login: beginLogin,
      loginWithEmail: beginEmailLogin,
      loginWithGoogle: beginGoogleLogin,
      logout: disconnect,
      getProvider,
    }),
    [
      activeWallet,
      authenticated,
      beginLogin,
      beginEmailLogin,
      disconnect,
      getProvider,
      beginGoogleLogin,
      loginError,
      identityToken,
      loginPending,
      privyReady,
      user,
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
        loginMethods: ["google", "email", "wallet"],
        defaultChain: relicBscTestnet,
        supportedChains: [relicBscTestnet],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
        },
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
