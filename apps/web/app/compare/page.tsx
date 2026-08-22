import type { Metadata } from "next";
import Link from "next/link";

import {
  compareAgents,
  labelForCategory,
  relativeTime,
} from "../../lib/marketplace";
import { VerificationTier } from "../_components/verification-tier";

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
      <span className="overline">Evidence-first comparison</span>
      <h1>Compare what Relic has actually verified.</h1>
      <p className="hero-copy">
        No composite score hides the evidence. Compare operability, interfaces,
        execution history, and network directly.
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
                <th>Evidence dimension</th>
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
                <th>Verified interfaces</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.interfaces
                      .map((item) => item.toUpperCase())
                      .join(", ")}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Capabilities</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.capabilities.length > 0
                      ? agent.capabilities.join(", ")
                      : "Service-level evidence"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Invocation</th>
                {agents.map((agent) => (
                  <td key={agent.id} className="positive">
                    ✓ Verified
                  </td>
                ))}
              </tr>
              <tr>
                <th>Commerce</th>
                {agents.map((agent) => (
                  <td
                    key={agent.id}
                    className={
                      agent.tier === "Actionable" ? "positive" : "muted-cell"
                    }
                  >
                    {agent.tier === "Actionable"
                      ? "✓ Verified"
                      : "Not yet verified"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Execution evidence</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.executionEvidenceCount > 0
                      ? `${agent.executionEvidenceCount} completed`
                      : "None recorded yet"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Hiring</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.hireable
                      ? "Hireable now"
                      : "No active verified offer"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Pricing</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.pricingKnown ? "Published" : "Not published"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Reputation evidence</th>
                {agents.map((agent) => (
                  <td key={agent.id}>
                    {agent.feedbackCount > 0
                      ? `${agent.feedbackCount} feedback records`
                      : "No credible feedback yet"}
                  </td>
                ))}
              </tr>
              <tr>
                <th>Last verified</th>
                {agents.map((agent) => (
                  <td key={agent.id}>{relativeTime(agent.lastVerifiedAt)}</td>
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
