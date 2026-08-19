import { describe, expect, it } from "vitest";

import { parseReferenceRuntimeEnvironment } from "../src/runtime-environment.js";

const validEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  NETWORK: "bsc-testnet",
  DATABASE_URL: "postgresql://user:password@example.test/relic",
  WALLET_PASSWORD: "injected-secret",
  WALLET_ADDRESS: "0x323F064B777745703Fa8eB56109A763503AeE4Dd",
  WALLET_KEYSTORE_DIR: "/run/secrets/relic-health-factor",
  ERC8183_SERVICE_PRICE: "0",
  ERC8183_AGENT_URL: "https://seller.example/erc8183",
  ERC8183_POLICY_ADDRESS: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea",
  BSC_TESTNET_RPC_URL: "https://rpc.example",
  RPC_URL_BSC_TESTNET: "https://logs-rpc.example",
  VENUS_BSC_TESTNET_COMPTROLLER: "0x0000000000000000000000000000000000000001",
});

describe("reference runtime environment", () => {
  it("accepts an injected-keystore production configuration", () => {
    expect(parseReferenceRuntimeEnvironment(validEnvironment())).toMatchObject({
      port: 8003,
      fundedPollInterval: 15,
      keystoreDirectory: "/run/secrets/relic-health-factor",
    });
  });

  it("forbids private-key import", () => {
    expect(() =>
      parseReferenceRuntimeEnvironment({
        ...validEnvironment(),
        PRIVATE_KEY: `0x${"1".repeat(64)}`,
      }),
    ).toThrow(/PRIVATE_KEY is forbidden/);
  });

  it("requires HTTPS for the public production endpoint", () => {
    expect(() =>
      parseReferenceRuntimeEnvironment({
        ...validEnvironment(),
        ERC8183_AGENT_URL: "http://seller.example/erc8183",
      }),
    ).toThrow(/must use HTTPS/);
  });
});
