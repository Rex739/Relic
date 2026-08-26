import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("reference runtime authority boundary", () => {
  it("contains no autonomous funded-job submission path", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/runtime-bootstrap.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("fundedJobWatcher(");
    expect(source).not.toContain("submitResult(");
    expect(source).toContain(
      'telemetry.capture("funded-job-polling:disabled-no-signing-authority")',
    );
  });
});
