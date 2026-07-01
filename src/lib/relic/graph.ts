import type { Edge, Node } from "@xyflow/react";
import type { ReviewResult } from "./types";

const positions: Record<string, { x: number; y: number }> = {
  "regulatory-surcharge-rule": { x: 40, y: 120 },
  "billing-policy-resolver": { x: 280, y: 120 },
  "commercial-invoice-service": { x: 520, y: 120 },
  "legacy-volume-discount": { x: 520, y: 285 },
  "invoice-ledger-writer": { x: 760, y: 190 },
  "finance-reporting-adapter": { x: 1000, y: 105 },
  "commercial-billing-report": { x: 1240, y: 105 },
  "invoice-audit-trail": { x: 1000, y: 285 },
  "customer-tier-resolver": { x: 280, y: 320 },
  "customer-account-repository": { x: 40, y: 320 },
};

export function createFlowGraph(review: ReviewResult): { nodes: Node[]; edges: Edge[] } {
  const impacted = new Set(review.impactAnalysis.impactedComponents.map((item) => item.component.id));
  const critical = new Set(
    review.impactAnalysis.impactedComponents
      .filter((item) => item.severity === "critical")
      .map((item) => item.component.id),
  );

  return {
    nodes: review.components.map((component) => ({
      id: component.id,
      position: positions[component.id] ?? { x: 0, y: 0 },
      data: {
        label: component.name,
        component,
        impacted: impacted.has(component.id),
        critical: critical.has(component.id),
      },
      type: "default",
      className: critical.has(component.id)
        ? "critical-node"
        : impacted.has(component.id)
          ? "impacted-node"
          : "default-node",
    })),
    edges: review.dependencies.map((edge) => ({
      id: `${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: edge.relationship,
      animated: Boolean(edge.critical),
      className: edge.critical ? "critical-edge" : "default-edge",
    })),
  };
}
