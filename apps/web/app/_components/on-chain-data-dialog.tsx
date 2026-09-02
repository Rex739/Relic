"use client";

import { ExternalLink } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";

type TechnicalData = {
  externalAgentId: string;
  chainId: number;
  registryAddress: string;
  ownerAddress: string;
  registrationBlock: string | number | null;
  metadataUri: string;
  serviceEndpoints: string[];
  offerTerms: Array<{ version: number; termsHash: string }>;
  evidence: Array<{ fieldPath: string; source: string; observedAt: string }>;
};

export function OnChainDataDialog({ data }: { data: TechnicalData }) {
  const values = [
    ["ERC-8004 Agent ID", data.externalAgentId],
    ["Chain ID", String(data.chainId)],
    ["Registry address", data.registryAddress],
    ["Owner", data.ownerAddress],
    ["Registration block", data.registrationBlock ?? "Not recorded"],
    ["Metadata URI", data.metadataUri],
    ...data.serviceEndpoints.map((endpoint) => ["Service endpoint", endpoint]),
    ...data.offerTerms.map((offer) => [
      `Offer v${offer.version} terms hash`,
      offer.termsHash,
    ]),
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="on-chain-data-trigger" type="button">
          View all <ExternalLink aria-hidden="true" size={14} />
        </button>
      </DialogTrigger>
      <DialogContent className="on-chain-data-dialog-content">
        <DialogHeader>
          <span className="overline">On-chain data</span>
          <DialogTitle>Agent identity and service records</DialogTitle>
          <DialogDescription>
            Raw identity, registry, service, and offer references for this
            agent.
          </DialogDescription>
        </DialogHeader>
        <dl className="on-chain-data-list">
          {values.map(([label, value], index) => (
            <div key={`${label}-${index}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {data.evidence.length > 0 ? (
          <div className="on-chain-evidence">
            <h3>Evidence and provenance</h3>
            {data.evidence.map((item, index) => (
              <p key={`${item.fieldPath}-${item.observedAt}-${index}`}>
                <b>{item.fieldPath}</b> · {item.source} · {item.observedAt}
              </p>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
