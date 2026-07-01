export type ComponentType =
  | "service"
  | "rule"
  | "repository"
  | "adapter"
  | "report"
  | "ledger"
  | "audit";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AgentStatus = "queued" | "analyzing" | "completed" | "blocked";
export type TestStatus = "passed" | "failed";
export type EvidenceSeverity = "informational" | "warning" | "critical";
export type ReviewDecision = "APPROVED" | "BLOCKED";
export type AgentRole = "Mapper" | "Planner" | "Red Team" | "Test Runner" | "Verdict";

export interface DependencyEdge {
  from: string;
  to: string;
  relationship: string;
  critical?: boolean;
}

export interface SystemComponent {
  id: string;
  name: string;
  type: ComponentType;
  description: string;
  owner: string;
  criticality: RiskLevel;
  sourceReference: string;
  tags: string[];
}

export interface ChangeRequest {
  id: string;
  systemName: string;
  title: string;
  requestedChange: string;
  affectedComponentId: string;
  objective: string;
  riskSensitivity: "Standard" | "Strict" | "Critical";
}

export interface ImpactedComponent {
  component: SystemComponent;
  distance: number;
  impactType: "direct" | "indirect";
  severity: RiskLevel;
  path: string[];
}

export interface ImpactAnalysis {
  changeComponentId: string;
  impactedComponents: ImpactedComponent[];
  directImpactCount: number;
  indirectImpactCount: number;
  criticalComponentCount: number;
  criticalPathCount: number;
  blastRadiusScore: number;
  summary: string;
}

export interface RegressionTestCase {
  id: string;
  name: string;
  description: string;
}

export interface RegressionTestResult {
  id: string;
  name: string;
  status: TestStatus;
  summary: string;
  details: string;
  severity?: RiskLevel;
  affectedAccounts?: number;
  sourceReferences: string[];
  remediation?: string;
  affectedComponentIds: string[];
}

export interface EvidenceReference {
  id: string;
  sourceReference: string;
  title: string;
  relatedComponentId: string;
  proves: string;
  severity: EvidenceSeverity;
  relatedAgent: AgentRole;
  excerpt: string;
}

export interface AgentRun {
  id: string;
  role: AgentRole;
  title: string;
  status: AgentStatus;
  summary: string;
  evidenceReferences: string[];
  timestamp: string;
  keyFindings: string[];
  severity?: RiskLevel;
  impactedComponentIds?: string[];
}

export interface SafetyCertificate {
  reviewId: string;
  systemName: string;
  requestedChange: string;
  finalDecision: ReviewDecision;
  riskLevel: RiskLevel;
  impactedComponentCount: number;
  criticalComponentCount: number;
  failedTestCount: number;
  affectedAccountCount: number;
  requiredHumanSignOffs: string[];
  generatedTimestamp: string;
  evidenceReferences: string[];
  receiptHash: string;
}

export interface ReviewResult {
  reviewId: string;
  startedAt: string;
  environment: "Simulation";
  changeRequest: ChangeRequest;
  decision: ReviewDecision;
  decisionReason: string;
  affectedAccountCount: number;
  requiredHumanSignOffs: string[];
  impactAnalysis: ImpactAnalysis;
  regressionResults: RegressionTestResult[];
  agents: AgentRun[];
  evidence: EvidenceReference[];
  certificate: SafetyCertificate;
  components: SystemComponent[];
  dependencies: DependencyEdge[];
}
