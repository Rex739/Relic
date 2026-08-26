import { describe, expect, it } from "vitest";

import {
  agentAvatarTone,
  agentInitials,
  usableAgentImageUrl,
} from "./agent-presentation";

describe("agent presentation", () => {
  it("accepts web images and rejects non-renderable metadata schemes", () => {
    expect(usableAgentImageUrl("https://agents.example/avatar.png")).toBe(
      "https://agents.example/avatar.png",
    );
    expect(usableAgentImageUrl("ipfs://avatar")).toBeNull();
    expect(usableAgentImageUrl("not a url")).toBeNull();
  });

  it("creates stable human fallbacks", () => {
    expect(agentInitials("Relic Health Factor Monitor")).toBe("RH");
    expect(agentAvatarTone("agent-1840")).toBe(agentAvatarTone("agent-1840"));
  });
});
