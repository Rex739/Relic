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
  help?: string;
  required?: boolean;
  type?: "text" | "number";
  min?: number;
  max?: number;
  step?: number | "any";
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
        min: 0.000000000000000001,
        step: "any",
      },
      {
        name: "durationDays",
        label: "Monitoring period (days)",
        placeholder: "14",
        helper: "14 days is recommended so the checkout policy can safely cover the monitoring window. You can pause or end monitoring at any time.",
        type: "number",
        min: 1,
        max: 365,
        step: 1,
      },
    ],
    deliverables: ["Current health factor", "Liquidation-risk status", "Actionable alert when attention is needed"],
    permissionSummary: "Read-only access to public on-chain position data. This service cannot move funds or submit transactions.",
  },
  rebalancing: {
    taskLabel: "LP Range Rebalancing",
    taskDescription:
      "Keep one PancakeSwap V3 BNB/USDT liquidity position in range, within the limits you choose.",
    confirmLabel: "Confirm rebalance settings",
    requirements: [
      {
        name: "positionTokenId",
        label: "PancakeSwap V3 position ID",
        placeholder: "e.g. 12345",
        helper: "The NFT ID of the one BNB/USDT position this order may manage.",
        help: "PancakeSwap V3 liquidity positions are NFTs. This identifies the single position the agent may withdraw from and redeploy.",
        required: true,
        type: "number",
        min: 1,
        step: 1,
      },
      {
        name: "capitalCap",
        label: "Maximum capital",
        placeholder: "e.g. 50",
        helper: "The most TEST_USDT-equivalent capital this order may use.",
        help: "This is a total cap, not a target balance. The agent must stop rather than use more than this amount.",
        required: true,
        type: "number",
        min: 0.000000000000000001,
        step: "any",
      },
      {
        name: "rangeWidthBps",
        label: "Range width on each side",
        placeholder: "e.g. 1000",
        helper: "Basis points around the current price. 1000 = 10% above and below.",
        help: "A narrower range can earn fees more actively but needs rebalancing sooner. A wider range trades activity for fewer adjustments.",
        required: true,
        type: "number",
        min: 100,
        max: 5000,
        step: 1,
      },
      {
        name: "durationHours",
        label: "Run time (hours)",
        placeholder: "e.g. 24",
        helper: "The permission expires automatically when this period ends.",
        required: true,
        type: "number",
        min: 1,
        max: 168,
        step: 1,
      },
    ],
    deliverables: [
      "Current range, price, and in-range status",
      "Each completed rebalance with transaction evidence",
      "Fees collected, new range, capital used, and stop reason",
    ],
    permissionSummary:
      "The agent may act only on this one BNB/USDT position, through the approved PancakeSwap V3 contracts, within your cap, duration, and one-rebalance-per-hour limit.",
  },
  "grid-trading": {
    taskLabel: "Grid Trading",
    taskDescription:
      "Run a rule-bound BNB/USDT grid within the capital, price, and time limits you choose.",
    confirmLabel: "Confirm grid settings",
    requirements: [
      {
        name: "capitalCap",
        label: "Maximum trading capital",
        placeholder: "e.g. 25",
        helper: "The most this grid can use. It cannot exceed this amount.",
        required: true,
        type: "number",
        min: 0.000000000000000001,
        step: "any",
      },
      {
        name: "lowerPrice",
        label: "Lower price",
        placeholder: "e.g. 550",
        helper: "No new grid buys are placed below this BNB/USDT price.",
        required: true,
        type: "number",
        min: 0.000000000000000001,
        step: "any",
      },
      {
        name: "upperPrice",
        label: "Upper price",
        placeholder: "e.g. 700",
        helper: "No new grid sells are placed above this BNB/USDT price.",
        required: true,
        type: "number",
        min: 0.000000000000000001,
        step: "any",
      },
      {
        name: "gridLevels",
        label: "Grid levels",
        placeholder: "e.g. 6",
        helper: "Choose 5–8 levels for the first release.",
        help: "Price points between your lower and upper limits where the strategy can buy or sell. More levels create smaller, more frequent steps.",
        required: true,
        type: "number",
        min: 5,
        max: 8,
        step: 1,
      },
      {
        name: "durationHours",
        label: "Run time (hours)",
        placeholder: "e.g. 24",
        helper: "The grid stops automatically when this period ends.",
        required: true,
        type: "number",
        min: 1,
        max: 168,
        step: 1,
      },
    ],
    deliverables: [
      "Live grid status and current market price",
      "Each executed swap with transaction evidence",
      "Remaining capital, completed levels, and stop reason",
    ],
    permissionSummary:
      "The agent can trade only through the approved router, within your capital cap, price range, and run time. Relic shows every on-chain action.",
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
