import { describe, expect, it } from "vitest";
import { analyzeDependencies } from "@/lib/relic/dependencyAnalyzer";
import { meridianChangeRequest, meridianComponents, meridianDependencies } from "@/lib/relic/fixture";

describe("dependency analyzer", () => {
  it("returns expected downstream impacted components for RegulatorySurchargeRule", () => {
    const analysis = analyzeDependencies(
      meridianChangeRequest.affectedComponentId,
      meridianComponents,
      meridianDependencies,
    );
    const names = analysis.impactedComponents.map((item) => item.component.name);

    expect(analysis.impactedComponents).toHaveLength(8);
    expect(names).toContain("CommercialInvoiceService");
    expect(names).toContain("LegacyVolumeDiscount");
    expect(names).toContain("InvoiceLedgerWriter");
    expect(names).toContain("CommercialBillingReport");
  });
});
