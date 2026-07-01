import type { DependencyEdge, ImpactAnalysis, ImpactedComponent, RiskLevel, SystemComponent } from "./types";

const severityWeight: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function rankSeverity(component: SystemComponent, distance: number): RiskLevel {
  if (component.criticality === "critical") {
    return "critical";
  }

  if (distance <= 1 && component.criticality === "high") {
    return "high";
  }

  return component.criticality;
}

export function analyzeDependencies(
  changeComponentId: string,
  components: SystemComponent[],
  dependencies: DependencyEdge[],
): ImpactAnalysis {
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const adjacency = new Map<string, DependencyEdge[]>();

  for (const edge of dependencies) {
    const existing = adjacency.get(edge.from) ?? [];
    existing.push(edge);
    adjacency.set(edge.from, existing);
  }

  const queue: Array<{ id: string; distance: number; path: string[] }> = [
    { id: changeComponentId, distance: 0, path: [changeComponentId] },
  ];
  const visited = new Map<string, { distance: number; path: string[] }>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || visited.has(current.id)) {
      continue;
    }

    visited.set(current.id, { distance: current.distance, path: current.path });

    const nextEdges = [...(adjacency.get(current.id) ?? [])].sort((a, b) => a.to.localeCompare(b.to));
    for (const edge of nextEdges) {
      if (!visited.has(edge.to)) {
        queue.push({
          id: edge.to,
          distance: current.distance + 1,
          path: [...current.path, edge.to],
        });
      }
    }
  }

  const impactedComponents: ImpactedComponent[] = [...visited.entries()]
    .map(([id, impact]) => {
      const component = componentMap.get(id);
      if (!component) {
        return undefined;
      }

      return {
        component,
        distance: impact.distance,
        impactType: impact.distance <= 1 ? "direct" : "indirect",
        severity: rankSeverity(component, impact.distance),
        path: impact.path,
      } satisfies ImpactedComponent;
    })
    .filter((item): item is ImpactedComponent => Boolean(item))
    .sort((a, b) => {
      const severityDelta = severityWeight[b.severity] - severityWeight[a.severity];
      if (severityDelta !== 0) {
        return severityDelta;
      }

      return a.distance - b.distance || a.component.name.localeCompare(b.component.name);
    });

  const criticalPathCount = dependencies.filter(
    (edge) => edge.critical && visited.has(edge.from) && visited.has(edge.to),
  ).length;
  const criticalComponentCount = impactedComponents.filter((item) => item.severity === "critical").length;
  const blastRadiusScore = Math.min(
    100,
    impactedComponents.reduce((total, item) => total + severityWeight[item.severity] * (item.distance + 1), 0),
  );

  return {
    changeComponentId,
    impactedComponents,
    directImpactCount: impactedComponents.filter((item) => item.impactType === "direct").length,
    indirectImpactCount: impactedComponents.filter((item) => item.impactType === "indirect").length,
    criticalComponentCount,
    criticalPathCount,
    blastRadiusScore,
    summary: `${impactedComponents.length} impacted components identified across ${criticalPathCount} critical paths.`,
  };
}
