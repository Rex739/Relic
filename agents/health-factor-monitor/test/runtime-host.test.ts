import { describe, expect, it } from "vitest";

import {
  type ReferenceAgentMount,
  referenceRuntimeReadiness,
} from "../src/runtime-host.js";

describe("reference runtime host", () => {
  it("reports aggregate readiness without performing external checks", () => {
    const agent: ReferenceAgentMount = {
      slug: "fixture-agent",
      ready: () => true,
      close: () => Promise.resolve(),
      handle: () => Promise.resolve(false),
    };
    expect(referenceRuntimeReadiness(true, [agent])).toMatchObject({
      ready: true,
      body: {
        status: "ready",
        agents: ["fixture-agent"],
      },
    });
    expect(referenceRuntimeReadiness(false, [agent])).toMatchObject({
      ready: false,
      body: { status: "not_ready", agents: [] },
    });
  });
});
