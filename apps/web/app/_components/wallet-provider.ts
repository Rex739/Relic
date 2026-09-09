"use client";

export type EthereumProvider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", listener: () => void): void;
  removeListener?(
    event: "accountsChanged" | "chainChanged",
    listener: () => void,
  ): void;
};

const BSC_TESTNET = {
  chainId: "0x61",
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "Test BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
};

const BSC_MAINNET = {
  chainId: "0x38",
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
  blockExplorerUrls: ["https://bscscan.com"],
};

export const walletChainId = async (provider: EthereumProvider) =>
  Number.parseInt(
    (await provider.request({ method: "eth_chainId" })) as string,
    16,
  );

export async function switchWalletChain(
  provider: EthereumProvider,
  chainId: number,
) {
  const requestedChain = chainId === 56
    ? BSC_MAINNET
    : chainId === 97
      ? BSC_TESTNET
      : null;
  if (requestedChain === null)
    throw new Error("Relic supports BSC Mainnet and BSC Testnet only.");
  const target = `0x${chainId.toString(16)}`;
  if ((await walletChainId(provider)) === chainId) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target }],
    });
  } catch (caught) {
    const code =
      typeof caught === "object" && caught !== null && "code" in caught
        ? Number(caught.code)
        : null;
    if (code !== 4902) throw caught;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [requestedChain],
    });
  }
  if ((await walletChainId(provider)) !== chainId)
    throw new Error(`Wallet did not switch to ${requestedChain.chainName}`);
}

export function walletTypedDataPayload(typedData: Record<string, unknown>) {
  const types = typedData.types;
  if (typeof types !== "object" || types === null || Array.isArray(types))
    throw new Error("Relic authorization typed data is missing its types");
  return {
    ...typedData,
    types: {
      ...types,
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  };
}
