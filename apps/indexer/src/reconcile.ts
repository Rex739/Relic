import type { ScanAgent } from "@relic/blockchain";
import type { AgentDetail } from "@relic/domain";

export type ReconciliationClassification =
  | "match"
  | "mismatch"
  | "unavailable_direct"
  | "unavailable_secondary"
  | "stale_secondary"
  | "unverified_secondary";

export interface ReconciliationFact {
  fieldPath: string;
  status: ReconciliationClassification;
  directValue: unknown;
  secondaryValue: unknown;
}

const normalized = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export function reconcileAgent(
  direct: AgentDetail | null,
  secondary: ScanAgent | null,
): ReconciliationFact[] {
  if (direct === null)
    return [
      {
        fieldPath: "identity",
        status:
          secondary === null ? "unavailable_direct" : "unavailable_direct",
        directValue: null,
        secondaryValue: secondary,
      },
    ];
  if (secondary === null)
    return [
      {
        fieldPath: "identity",
        status: "unavailable_secondary",
        directValue: direct.externalAgentId,
        secondaryValue: null,
      },
    ];
  const pairs: Array<[string, unknown, unknown, boolean]> = [
    [
      "identity.ownerAddress",
      direct.ownerAddress,
      secondary.owner_address,
      true,
    ],
    [
      "identity.registryAddress",
      direct.registryAddress,
      secondary.contract_address,
      true,
    ],
    ["identity.agentId", direct.externalAgentId, secondary.token_id, true],
    ["profile.name", direct.name, secondary.name, false],
    ["profile.description", direct.description, secondary.description, false],
    ["profile.imageUrl", direct.imageUrl, secondary.image_url, false],
  ];
  return pairs.map(([fieldPath, directValue, secondaryValue, onchain]) => {
    let status: ReconciliationClassification;
    if (directValue === null || directValue === undefined)
      status = onchain ? "unavailable_direct" : "unverified_secondary";
    else if (secondaryValue === null || secondaryValue === undefined)
      status = "unavailable_secondary";
    else
      status =
        normalized(directValue) === normalized(secondaryValue)
          ? "match"
          : "mismatch";
    return { fieldPath, status, directValue, secondaryValue };
  });
}
