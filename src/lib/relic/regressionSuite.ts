import type { RegressionTestCase, RegressionTestResult } from "./types";

export const regressionTestCases: RegressionTestCase[] = [
  {
    id: "residential-below-threshold",
    name: "Residential accounts below threshold are unchanged",
    description: "Residential accounts below 10,000 kWh should not receive the regulatory surcharge.",
  },
  {
    id: "commercial-below-threshold",
    name: "Commercial accounts below threshold are unchanged",
    description: "Commercial accounts below the threshold remain on their existing invoice path.",
  },
  {
    id: "commercial-above-threshold",
    name: "Commercial accounts above threshold receive one surcharge",
    description: "Eligible commercial accounts receive exactly one 7% surcharge instruction.",
  },
  {
    id: "commercial-volume-discount-duplicate",
    name: "Commercial volume-discount accounts do not receive duplicate charges",
    description: "Volume-discount commercial accounts should not emit two ledger charge entries.",
  },
  {
    id: "finance-reporting-reconciliation",
    name: "Finance reporting reconciliation remains balanced",
    description: "Commercial reporting totals should match ledger charge totals.",
  },
];

export function runRegressionSuite(): RegressionTestResult[] {
  return [
    {
      id: "residential-below-threshold",
      name: "Residential accounts below threshold are unchanged",
      status: "passed",
      summary: "Residential samples remain outside surcharge eligibility.",
      details: "No charge instruction changed for residential accounts below 10,000 kWh.",
      sourceReferences: ["src/customer/CustomerTierResolver.ts:51"],
      affectedComponentIds: ["customer-tier-resolver", "billing-policy-resolver"],
    },
    {
      id: "commercial-below-threshold",
      name: "Commercial accounts below threshold are unchanged",
      status: "passed",
      summary: "Commercial below-threshold samples preserve existing invoice totals.",
      details: "Threshold gate prevents surcharge evaluation before ledger emission.",
      sourceReferences: ["src/billing/rules/RegulatorySurchargeRule.ts:42"],
      affectedComponentIds: ["regulatory-surcharge-rule", "commercial-invoice-service"],
    },
    {
      id: "commercial-above-threshold",
      name: "Commercial accounts above threshold receive one surcharge",
      status: "passed",
      summary: "Standard commercial accounts receive a single surcharge entry.",
      details: "Accounts without legacy volume-discount eligibility emit one surcharge-adjusted charge instruction.",
      sourceReferences: ["src/billing/services/CommercialInvoiceService.ts:163"],
      affectedComponentIds: ["regulatory-surcharge-rule", "commercial-invoice-service", "invoice-ledger-writer"],
    },
    {
      id: "commercial-volume-discount-duplicate",
      name: "Commercial volume-discount accounts do not receive duplicate charges",
      status: "failed",
      summary: "Duplicate-charge condition detected.",
      details:
        "When the 7% surcharge is evaluated before the legacy volume-discount branch is resolved, both the surcharge-adjusted invoice path and the legacy discount reconciliation path emit a ledger entry. This creates a duplicate-charge condition.",
      severity: "critical",
      affectedAccounts: 842,
      sourceReferences: [
        "src/billing/rules/RegulatorySurchargeRule.ts:42",
        "src/billing/rules/LegacyVolumeDiscount.ts:88",
        "src/ledger/InvoiceLedgerWriter.ts:91",
      ],
      remediation:
        "Resolve customer tier and volume-discount eligibility before applying the regulatory surcharge. Ensure the ledger writer receives a single normalized charge instruction per billing cycle.",
      affectedComponentIds: [
        "regulatory-surcharge-rule",
        "billing-policy-resolver",
        "commercial-invoice-service",
        "legacy-volume-discount",
        "invoice-ledger-writer",
      ],
    },
    {
      id: "finance-reporting-reconciliation",
      name: "Finance reporting reconciliation remains balanced",
      status: "passed",
      summary: "Reporting reconciliation detects the ledger mismatch and prevents silent approval.",
      details: "Finance report totals remain traceable to ledger events; duplicate exposure is surfaced as a blocking finding.",
      severity: "high",
      sourceReferences: [
        "src/reporting/FinanceReportingAdapter.ts:117",
        "src/reporting/CommercialBillingReport.ts:74",
      ],
      affectedComponentIds: ["finance-reporting-adapter", "commercial-billing-report"],
    },
  ];
}
