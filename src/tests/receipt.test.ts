import { describe, expect, it } from "vitest";
import { hashCertificatePayload } from "@/lib/relic/receipt";
import type { SafetyCertificate } from "@/lib/relic/types";

type Payload = Omit<SafetyCertificate, "receiptHash">;

const basePayload: Payload = {
  reviewId: "REL-MER-2026-0701-001",
  systemName: "Meridian Grid · Billing Core",
  requestedChange: "Apply surcharge.",
  finalDecision: "BLOCKED",
  riskLevel: "critical",
  impactedComponentCount: 8,
  criticalComponentCount: 3,
  failedTestCount: 1,
  affectedAccountCount: 842,
  requiredHumanSignOffs: ["Finance Systems Owner", "Billing Policy Lead"],
  generatedTimestamp: "2026-07-01T09:14:00.000Z",
  evidenceReferences: ["ev-a", "ev-b"],
};

describe("receipt hashing", () => {
  it("produces stable hashes for identical payloads", () => {
    expect(hashCertificatePayload(basePayload)).toBe(hashCertificatePayload({ ...basePayload }));
  });

  it("produces different hashes when payloads change", () => {
    expect(hashCertificatePayload(basePayload)).not.toBe(
      hashCertificatePayload({ ...basePayload, affectedAccountCount: 843 }),
    );
  });
});
