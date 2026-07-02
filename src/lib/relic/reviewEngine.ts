import {
  evidenceReferences,
  institutionalKnowledgeRecords,
  meridianChangeRequest,
  meridianComponents,
  meridianDependencies,
} from "./fixture";
import { analyzeDependencies } from "./dependencyAnalyzer";
import { runRegressionSuite } from "./regressionSuite";
import { createSafetyCertificate } from "./receipt";
import type { AgentRun, ReviewDecision, ReviewResult } from "./types";

export function runMeridianReview(): ReviewResult {
  const impactAnalysis = analyzeDependencies(
    meridianChangeRequest.affectedComponentId,
    meridianComponents,
    meridianDependencies,
  );
  const regressionResults = runRegressionSuite();
  const failedTests = regressionResults.filter((result) => result.status === "failed");
  const duplicateFailure = failedTests.find((result) => result.id === "commercial-volume-discount-duplicate");
  const decision: ReviewDecision = failedTests.some((result) => result.severity === "critical") ? "BLOCKED" : "APPROVED";
  const affectedAccountCount = failedTests.reduce((total, result) => total + (result.affectedAccounts ?? 0), 0);

  const agents: AgentRun[] = [
    {
      id: "agent-mapper",
      role: "Mapper",
      title: "Dependency surface mapped",
      status: "completed",
      summary: impactAnalysis.summary,
      evidenceReferences: ["ev-invoice-merge"],
      timestamp: "09:10:04",
      keyFindings: [
        "RegulatorySurchargeRule reaches billing policy ordering, invoice orchestration, ledger writing, reporting, and audit trails.",
        "The impacted component count is derived from dependency traversal.",
      ],
      severity: "high",
      impactedComponentIds: impactAnalysis.impactedComponents.map((item) => item.component.id),
    },
    {
      id: "agent-planner",
      role: "Planner",
      title: "Implementation assumptions challenged",
      status: "completed",
      summary: "The policy can be implemented only after rule sequencing and eligibility boundaries are made explicit.",
      evidenceReferences: ["ev-policy-resolver"],
      timestamp: "09:10:19",
      keyFindings: [
        "Commercial tier and consumption threshold are insufficient eligibility gates.",
        "Legacy discount behavior must be resolved before surcharge ledger emission.",
      ],
      severity: "high",
      impactedComponentIds: ["billing-policy-resolver", "legacy-volume-discount"],
    },
    {
      id: "agent-red-team",
      role: "Red Team",
      title: "Unsafe interaction path found",
      status: "blocked",
      summary: "A duplicate-charge path appears when surcharge evaluation precedes legacy discount reconciliation.",
      evidenceReferences: ["ev-surcharge-order", "ev-volume-ledger", "ev-invoice-merge"],
      timestamp: "09:10:43",
      keyFindings: [
        "Both surcharge-adjusted invoice path and discount reconciliation path can emit ledger entries.",
        "Financial exposure is concentrated in commercial accounts above 10,000 kWh with volume-discount eligibility.",
      ],
      severity: "critical",
      impactedComponentIds: duplicateFailure?.affectedComponentIds,
    },
    {
      id: "agent-test-runner",
      role: "Test Runner",
      title: "Regression suite completed",
      status: "blocked",
      summary: "Four deterministic scenarios passed and one critical duplicate-charge scenario failed.",
      evidenceReferences: ["ev-volume-ledger", "ev-reporting-recon"],
      timestamp: "09:11:08",
      keyFindings: [
        "Commercial volume-discount duplicate-charge test failed.",
        `${affectedAccountCount.toLocaleString("en-US")} historical commercial accounts could be affected.`,
      ],
      severity: "critical",
      impactedComponentIds: duplicateFailure?.affectedComponentIds,
    },
    {
      id: "agent-verdict",
      role: "Verdict",
      title: "Release recommendation issued",
      status: decision === "BLOCKED" ? "blocked" : "completed",
      summary: "The change is blocked pending finance and billing policy sign-off.",
      evidenceReferences: ["ev-audit-trail", "ev-reporting-recon"],
      timestamp: "09:11:26",
      keyFindings: [
        "Critical failed regression exceeds strict risk threshold.",
        "Required sign-off: Finance Systems Owner and Billing Policy Lead.",
      ],
      severity: "critical",
      impactedComponentIds: duplicateFailure?.affectedComponentIds,
    },
  ];

  const reviewWithoutCertificate = {
    reviewId: "REL-MER-2026-0701-001",
    startedAt: "2026-07-01T09:10:00.000Z",
    environment: "Simulation" as const,
    changeRequest: meridianChangeRequest,
    decision,
    decisionReason: duplicateFailure?.summary ?? "No blocking regression detected.",
    affectedAccountCount,
    requiredHumanSignOffs: ["Finance Systems Owner", "Billing Policy Lead"],
    impactAnalysis,
    regressionResults,
    agents,
    evidence: evidenceReferences,
    institutionalKnowledge: institutionalKnowledgeRecords,
    components: meridianComponents,
    dependencies: meridianDependencies,
  };

  return {
    ...reviewWithoutCertificate,
    certificate: createSafetyCertificate(reviewWithoutCertificate),
  };
}
