export type MarketplaceCategory =
  | "rebalancing"
  | "grid-trading"
  | "yield-optimisation"
  | "health-factor-monitoring";

export type ServiceField = {
  name: string;
  label: string;
  placeholder: string;
  helper: string;
  required?: boolean;
  type?: "text" | "number";
};

export type ServiceWorkflow = {
  taskLabel: string;
  taskDescription: string;
  confirmLabel: string;
  requirements: ServiceField[];
  deliverables: string[];
  permissionSummary: string;
};

const addressField: ServiceField = {
  name: "publicAccount",
  label: "Wallet or public account",
  placeholder: "0x…",
  helper: "Used only to analyse the public position. Relic never receives spending access.",
  required: true,
};

const workflows: Record<MarketplaceCategory, ServiceWorkflow> = {
  "health-factor-monitoring": {
    taskLabel: "Health Factor Monitoring",
    taskDescription: "Watch a Venus lending position and alert you before its health factor becomes risky.",
    confirmLabel: "Confirm & start monitoring",
    requirements: [
      addressField,
      {
        name: "threshold",
        label: "Alert me below",
        placeholder: "1.30",
        helper: "Health-factor threshold.",
        type: "number",
      },
      {
        name: "durationDays",
        label: "Monitoring period (days)",
        placeholder: "14",
        helper: "14 days is recommended so the checkout policy can safely cover the monitoring window. You can pause or end monitoring at any time.",
        type: "number",
      },
    ],
    deliverables: ["Current health factor", "Liquidation-risk status", "Actionable alert when attention is needed"],
    permissionSummary: "Read-only access to public on-chain position data. This service cannot move funds or submit transactions.",
  },
  rebalancing: {
    taskLabel: "Rebalancing",
    taskDescription: "Review a public liquidity position against the operating bounds you choose.",
    confirmLabel: "Confirm & create task",
    requirements: [
      addressField,
      { name: "asset", label: "Asset or position", placeholder: "e.g. WBNB / USDT", helper: "The market or position to assess.", required: true },
      { name: "target", label: "Target range", placeholder: "e.g. 5% allocation band", helper: "The boundary the agent should evaluate." },
    ],
    deliverables: ["Position assessment", "Recommended rebalance", "Reasoning and risk notes"],
    permissionSummary: "The service begins in observe-only mode. Any transaction-capable action must be separately approved.",
  },
  "grid-trading": {
    taskLabel: "Grid Trading",
    taskDescription: "Create a rule-bound grid plan before any trading action is proposed.",
    confirmLabel: "Confirm & create task",
    requirements: [
      { name: "asset", label: "Trading pair", placeholder: "e.g. BNB / USDT", helper: "The market the grid should cover.", required: true },
      { name: "target", label: "Price range and grid", placeholder: "e.g. 520–680, 8 levels", helper: "Your requested operating bounds.", required: true },
      { name: "publicAccount", label: "Wallet (optional)", placeholder: "0x…", helper: "Only needed if the agent should assess an existing public position." },
    ],
    deliverables: ["Proposed grid parameters", "Risk and exposure summary", "Execution plan for your approval"],
    permissionSummary: "Relic will show any action that could trade or spend before it is submitted.",
  },
  "yield-optimisation": {
    taskLabel: "Yield Optimisation",
    taskDescription: "Compare yield opportunities within the asset and risk boundaries you set.",
    confirmLabel: "Confirm & create task",
    requirements: [
      { name: "asset", label: "Asset to optimise", placeholder: "e.g. USDT", helper: "The asset whose options you want compared.", required: true },
      { name: "target", label: "Risk preference", placeholder: "e.g. conservative, stablecoin only", helper: "Constraints the agent must respect.", required: true },
      { name: "publicAccount", label: "Wallet (optional)", placeholder: "0x…", helper: "Only needed to assess a public portfolio." },
    ],
    deliverables: ["Ranked opportunities", "Yield, risk and liquidity comparison", "Recommendation with supporting evidence"],
    permissionSummary: "This starts as analysis only. Relic will request explicit approval for any transaction-capable action.",
  },
};

export const serviceWorkflowFor = (category: string): ServiceWorkflow =>
  workflows[category as MarketplaceCategory] ?? {
    taskLabel: "Agent service",
    taskDescription: "Provide the details this service needs, then review the price and confirm your task.",
    confirmLabel: "Confirm & create task",
    requirements: [{ name: "objective", label: "What do you need done?", placeholder: "Describe the result you need", helper: "Be specific about the asset, account, target, or timeframe.", required: true }],
    deliverables: ["A structured service result", "Activity and delivery record"],
    permissionSummary: "Relic will show and request approval for permissions before an agent can act.",
  };
