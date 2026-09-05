"use client";

import type { PublicMarketplaceAgent } from "@relic/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  labelForCategory,
  marketplacePriceLabel,
  productCapabilityLabel,
  relativeTime,
} from "../../lib/marketplace";
import { AgentAvatar } from "./agent-avatar";
import { HireLink } from "./hire-link";

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
              <span className="live-status">
                <i /> Live
              </span>
              <span
                className={
                  agent.chainId === 97 ? "testnet-tag" : "network-label"
                }
              >
                {agent.network}
              </span>
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
              <AgentAvatar
                id={agent.id}
                imageUrl={agent.imageUrl}
                name={agent.name}
              />
              <div>
                <h3>{agent.name}</h3>
                <p className="category-label">
                  {labelForCategory(agent.category)}
                </p>
              </div>
            </Link>
            <p className="agent-description">{concise(agent.description)}</p>
            <div className="agent-card-tags">
              {agent.protocols.slice(0, 3).map((protocol) => (
                <span key={protocol}>{productCapabilityLabel(protocol)}</span>
              ))}
              {agent.interfaces.slice(0, 2).map((item) => (
                <span key={item}>{productCapabilityLabel(item)}</span>
              ))}
            </div>
            <dl className="agent-card-metrics">
              <div>
                <dt>Completion</dt>
                <dd>
                  {agent.completionRatePercent === null
                    ? "No job history yet"
                    : `${agent.completionRatePercent}% Completion · ${agent.completedCommerceJobCount} of ${agent.eligibleAcceptedJobCount} jobs`}
                </dd>
              </div>
              <div>
                <dt>Last active</dt>
                <dd>{relativeTime(agent.lastVerifiedAt)}</dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd>{marketplacePriceLabel(agent.activeOfferPrice)}</dd>
              </div>
              <div>
                <dt>Reviews</dt>
                <dd>
                  {agent.reviewCount > 0
                    ? `${agent.reviewCount} ${agent.reviewCount === 1 ? "review" : "reviews"} · ${agent.reviewGoodCount} good`
                    : "No verified reviews yet"}
                </dd>
              </div>
            </dl>
            <div className="card-footer">
              <Link href={`/agents/${agent.id}`} className="secondary-button">
                View agent
              </Link>
              {agent.hireable ? (
                <HireLink
                  href={`/agents/${agent.id}/hire`}
                  className="primary-button"
                >
                  Hire
                </HireLink>
              ) : (
                <span className="unavailable-copy">Not currently hireable</span>
              )}
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
