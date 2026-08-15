import type { RegistryAgentRecord } from "../src/index.js";

export const registryAgentFixture: RegistryAgentRecord = {
  source: "test-registry",
  chainId: 56,
  registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  agentId: "1",
  ownerAddress: "0x1111111111111111111111111111111111111111",
  metadataUri: "data:application/json;base64,e30=",
  metadata: {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Fixture Agent",
    description: "Only used in automated tests.",
    services: [{ name: "A2A", endpoint: "https://fixture.invalid/agent.json" }],
  },
  registrationTransaction:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  registrationBlock: "123",
  registeredAt: "2026-01-01T00:00:00.000Z",
  fetchedAt: "2026-01-02T00:00:00.000Z",
  raw: { fixture: true },
};
