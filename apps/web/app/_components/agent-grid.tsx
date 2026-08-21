"use client";

import type { PublicMarketplaceAgent } from "@relic/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { labelForCategory, relativeTime } from "../../lib/marketplace";
import { VerificationTier } from "./verification-tier";

const concise = (description: string) =>
  description.length > 150 ? `${description.slice(0, 147)}…` : description;

export function AgentGrid({ agents }: { agents: PublicMarketplaceAgent[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length === 4
          ? current
          : [...current, id],
    );

  return (
    <>
      <div className="agent-grid">
        {agents.map((agent) => (
          <article className="agent-card" key={agent.id}>
            <div className="agent-card-topline">
              <VerificationTier tier={agent.tier} />
              <label className="compare-check">
                <input
                  type="checkbox"
                  checked={selected.includes(agent.id)}
                  onChange={() => toggle(agent.id)}
                />
                Compare
              </label>
            </div>
            <Link href={`/agents/${agent.id}`} className="card-main-link">
              <div className="agent-avatar" aria-hidden="true">
                {agent.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h3>{agent.name}</h3>
                <p className="category-label">
                  {labelForCategory(agent.category)}
                </p>
              </div>
            </Link>
            <p className="agent-description">{concise(agent.description)}</p>
            <div className="card-network-row">
              <span className={agent.chainId === 97 ? "testnet-tag" : ""}>
                {agent.network}
              </span>
            </div>
            <dl className="card-service-facts">
              <div>
                <dt>Relevant protocols</dt>
                <dd>
                  {agent.protocols.length > 0
                    ? agent.protocols
                        .slice(0, 3)
                        .map((item) => item.toUpperCase())
                        .join(" · ")
                    : "Service-level evidence"}
                </dd>
              </div>
              <div>
                <dt>Verified interfaces</dt>
                <dd>
                  {agent.interfaces
                    .slice(0, 3)
                    .map((item) => item.toUpperCase())
                    .join(" · ")}
                </dd>
              </div>
            </dl>
            <dl className="card-evidence">
              <div>
                <dt>Current service</dt>
                <dd>
                  <i /> Available
                </dd>
              </div>
              <div>
                <dt>Invocation</dt>
                <dd>✓ Passed recently</dd>
              </div>
              <div>
                <dt>Completed execution evidence</dt>
                <dd>
                  {agent.executionEvidenceCount > 0
                    ? `${agent.executionEvidenceCount} recorded`
                    : "None recorded yet"}
                </dd>
              </div>
              <div>
                <dt>Commerce</dt>
                <dd>
                  {agent.tier === "Actionable"
                    ? "✓ Lifecycle verified"
                    : "Not yet verified"}
                </dd>
              </div>
              <div>
                <dt>Last verified</dt>
                <dd>{relativeTime(agent.lastVerifiedAt)}</dd>
              </div>
            </dl>
            <div className="card-footer">
              <span>
                {agent.tier === "Actionable"
                  ? "Available for future activation"
                  : "Working; commerce gated"}
              </span>
              <Link href={`/agents/${agent.id}`}>
                View intelligence <span aria-hidden="true">→</span>
              </Link>
            </div>
          </article>
        ))}
      </div>
      {selected.length > 0 ? (
        <div
          className="compare-tray"
          role="region"
          aria-label="Selected agents"
        >
          <span>
            <b>{selected.length}</b> selected
          </span>
          <button onClick={() => setSelected([])}>Clear</button>
          <button
            className="primary-button"
            onClick={() => router.push(`/compare?ids=${selected.join(",")}`)}
          >
            Compare agents
          </button>
        </div>
      ) : null}
    </>
  );
}
