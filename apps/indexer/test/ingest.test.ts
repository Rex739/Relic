import type { AgentRegistryProvider, RegistryAgentRecord } from "@relic/domain";
import { describe, expect, it, vi } from "vitest";

import { ingestAgentPage } from "../src/ingest.js";

const base: RegistryAgentRecord = {
  source: "test",
  chainId: 56,
  registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  agentId: "1",
  ownerAddress: "0x1111111111111111111111111111111111111111",
  metadataUri: "data:application/json;base64,e30=",
  metadata: { name: "Test-only agent", services: [] },
  registrationTransaction: null,
  registrationBlock: "1",
  registeredAt: null,
  fetchedAt: "2026-01-01T00:00:00.000Z",
  raw: {},
};

describe("agent ingestion", () => {
  it("keeps malformed metadata identities indexable without inventing fields", async () => {
    const provider: AgentRegistryProvider = {
      providerId: "test",
      getAgent: () => Promise.resolve(null),
      listAgents: () =>
        Promise.resolve({
          agents: [base, { ...base, agentId: "2", metadata: { services: [] } }],
          nextCursor: null,
        }),
    };
    const writer = {
      persist: vi.fn(() => Promise.resolve("id")),
      recordFailure: vi.fn(() => Promise.resolve()),
    };
    const result = await ingestAgentPage(provider, writer, 2);
    expect(result).toMatchObject({ ingested: 2, rejected: 0 });
    expect(writer.persist).toHaveBeenCalledTimes(2);
    expect(writer.recordFailure).not.toHaveBeenCalled();
  });
});
