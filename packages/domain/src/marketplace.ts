export type PublicVerificationTier = "Working" | "Actionable" | "Proven";

export interface PublicMarketplaceQuery {
  readonly page: number;
  readonly limit: number;
  readonly text?: string | undefined;
  readonly requirements?: string[] | undefined;
  readonly category?: string | undefined;
  readonly protocol?: string | undefined;
  readonly tier?: PublicVerificationTier | undefined;
  readonly chainId?: 56 | 97 | undefined;
  readonly interface?: string | undefined;
  readonly pricingKnown?: boolean | undefined;
  readonly hasReputation?: boolean | undefined;
}

export interface PublicMarketplaceAgent {
  id: string;
  name: string;
  description: string;
  category: string;
  tier: PublicVerificationTier;
  availability: "available";
  chainId: 56 | 97;
  network: "BNB Chain" | "BNB Chain Testnet";
  registryAddress: string;
  externalAgentId: string;
  supplyType: "third_party" | "partner" | "relic_reference";
  capabilities: string[];
  protocols: string[];
  interfaces: string[];
  pricingKnown: boolean;
  hireable: boolean;
  executionEvidenceCount: number;
  feedbackCount: number;
  lastVerifiedAt: string;
  updatedAt: string;
}

export interface PublicMarketplaceResult {
  items: PublicMarketplaceAgent[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PublicMarketplaceService {
  id: string;
  name: string;
  description: string | null;
  interface: string;
  endpoint: string;
  availability: "available";
  verificationLevel: "INVOCATION_VERIFIED" | "COMMERCE_VERIFIED";
  pricing: unknown;
  protocolSupport: Record<string, unknown>;
  lastVerifiedAt: string;
  provenance: string;
}

export interface PublicMarketplaceEvidence {
  fieldPath: string;
  label: string;
  provenance: string;
  source: string;
  sourceUri: string | null;
  observedAt: string;
}

export interface PublicMarketplaceOutcome {
  invocationSuccessful: boolean;
  commerceSuccessful: boolean;
  executionDurationMs: number | null;
  responseStatus: string | null;
  settlementState: string;
  observedCost: string;
  observedAt: string;
}

export interface PublicMarketplaceAgentDetail extends PublicMarketplaceAgent {
  ownerAddress: string;
  metadataUri: string;
  registrationTransaction: string | null;
  registrationBlock: string | null;
  services: PublicMarketplaceService[];
  evidence: PublicMarketplaceEvidence[];
  outcomes: PublicMarketplaceOutcome[];
  surfacedBecause: string[];
  checks: {
    identityVerified: boolean;
    endpointReachable: boolean;
    protocolVerified: boolean;
    invocationVerified: boolean;
    commerceVerified: boolean;
    lastCheckedAt: string;
  };
}

export interface PublicCategoryCount {
  slug: string;
  label: string;
  working: number;
  actionable: number;
  protocols: string[];
}

export interface InternalMarketplaceStatus {
  discovered: number;
  enriched: number;
  pendingEnrichment: number;
  verificationQueue: number;
  directlyVerified: number;
  serviceDeclared: number;
  invocationVerified: number;
  actionable: number;
  staleOrUnreachable: number;
  publicMarketplace: number;
  categoryCandidates: Record<string, number>;
}

export interface PublicMarketplaceRepository {
  listPublicMarketplace(
    query: PublicMarketplaceQuery,
  ): Promise<PublicMarketplaceResult>;
  findPublicMarketplaceAgent(
    id: string,
  ): Promise<PublicMarketplaceAgentDetail | null>;
  listPublicCategories(): Promise<PublicCategoryCount[]>;
  comparePublicMarketplaceAgents(
    ids: string[],
  ): Promise<PublicMarketplaceAgent[]>;
  internalMarketplaceStatus(): Promise<InternalMarketplaceStatus>;
}
