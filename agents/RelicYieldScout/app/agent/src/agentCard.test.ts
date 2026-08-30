import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentCard } from "./agentCard.js";

test("uses the public display name without changing the deployment slug", () => {
  assert.equal(buildAgentCard().name, "Relic Yield Scout");
});
