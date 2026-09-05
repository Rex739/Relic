import type { Metadata } from "next";
import Link from "next/link";

import {
  compareAgents,
  labelForCategory,
  marketplacePriceLabel,
  productCapabilityLabel,
  relativeTime,
} from "../../lib/marketplace";
import { VerificationTier } from "../_components/verification-tier";
import { HireLink } from "../_components/hire-link";

export const metadata: Metadata = { title: "Compare verified agents" };
export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const raw = (await searchParams).ids;
  const ids =
    typeof raw === "string"
      ? [...new Set(raw.split(",").filter(Boolean))].slice(0, 4)
      : [];
  const response =
    ids.length > 0
      ? await compareAgents(ids)
      : { data: { data: [] }, error: null };
  const agents = response.data?.data ?? [];

  return (
    <main className="page-shell compare-page">
      <span className="overline">Agent comparison</span>
      <h1>Choose the right agent.</h1>
      <p className="hero-copy">
        Compare live status, capabilities, pricing availability, permissions,
        and real history. No mystery score.
      </p>
      {ids.length === 0 ? (
        <div className="state-panel">
          <span>No agents selected</span>
          <h3>Select up to four verified agents from the marketplace.</h3>
          <p>
            Comparison is restricted to public-eligible inventory; corpus
            candidates cannot be inserted by URL.
          </p>
          <Link href="/marketplace">Choose agents</Link>
        </div>
      ) : response.error !== null ? (
        <div className="state-panel">
          <span>Unavailable</span>
          <h3>Comparison could not be loaded.</h3>
          <p>{response.error}</p>
        </div>
      ) : (
        <div className="comparison-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Compare</th>
                {agents.map((agent) => (
                  <th key={agent.id}>
                    <div className="agent-avatar">
                      {agent.name.slice(0, 2).toUpperCase()}
                    </div>
                    <Link href={`/agents/${agent.id}`}>{agent.name}</Link>
                    <VerificationTier tier={agent.tier} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Status</th>
                {agents.map((agent) => (
                  <td key={agent.id} className="positive">
                    ● Live
                  </td>
                ))}
              </tr>
              <tr>
                <th>Category</th>
                {agents.map((agent) => (
                  <td key={agent.id}>{labelForCategory(agent.category)}</td>
                ))}
              </tr>
              <tr>
                <th>Network</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    <span className={agent.chainId === 97 ? "testnet-tag" : ""}>
                      {agent.network}
                    </span>
                  </td>
                ))}
              </tr>
              <tr>
                <th>Service compatibility</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.interfaces.map(productCapabilityLabel).join(", ")}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Capabilities</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.capabilities.length > 0
                      ? agent.capabilities
                          .map(productCapabilityLabel)
                          .join(", ")
                      : "Service-level evidence"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Recent service check</th>
                {agents.map((agent) => (
                  <td key={agent.id} className="positive">
                    Passed · {relativeTime(agent.lastVerifiedAt)}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Hiring readiness</th>
                {agents.map((agent) => (
                  <td
                    key={agent.id}
                    className={agent.hireable ? "positive" : "muted-cell"}
                  >
                    {agent.hireable
                      ? "Available to hire"
                      : agent.tier === "Actionable"
                        ? "Verified; no active offer"
                        : "Not yet hireable"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Completion rate</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.completionRatePercent === null
                      ? "No job history yet"
                      : `${agent.completionRatePercent}% Completion · ${agent.completedCommerceJobCount} of ${agent.eligibleAcceptedJobCount} jobs`}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Completed jobs</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.completedCommerceJobCount > 0
                      ? agent.completedCommerceJobCount
                      : "No completed commerce jobs yet"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Availability</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.hireable ? "Available to hire" : "No active offer"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Price / billing</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {marketplacePriceLabel(agent.activeOfferPrice)}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Reviews</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.reviewCount > 0
                      ? `${agent.reviewCount} ${agent.reviewCount === 1 ? "review" : "reviews"} · ${agent.reviewGoodCount} good · ${agent.reviewBadCount} bad`
                      : "No verified reviews yet"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Last active</th>
                {agents.map((agent) => (
                  <td key={agent.id}>{relativeTime(agent.lastVerifiedAt)}</td>
                ))}
              </tr>
              <tr>
                <th>Funds permissions</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.category === "health-factor-monitoring"
                      ? "Read-only for published Health Factor service"
                      : "Review service permissions before hiring"}
                  </td>
                ))}
              </tr>
              <tr className="comparison-actions-row">
                <th>Next step</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.hireable ? (
                      <HireLink
                        className="primary-button"
                        href={`/agents/${agent.id}/hire`}
                      >
                        Hire this agent
                      </HireLink>
                    ) : (
                      <Link
                        className="secondary-button"
                        href={`/agents/${agent.id}`}
                      >
                        View agent
                      </Link>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          {agents.length < ids.length ? (
            <p className="comparison-note">
              Some requested IDs were omitted because they do not meet the
              current public threshold.
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}
