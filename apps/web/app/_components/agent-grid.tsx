"use client";

import type { PublicMarketplaceAgent } from "@relic/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  marketplacePriceLabel,
  productCapabilityLabel,
  relativeTime,
} from "../../lib/marketplace";
import { AgentAvatar } from "./agent-avatar";
import { HireLink } from "./hire-link";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";

const mobileDescriptionPreviewLength = 96;
const desktopDescriptionPreviewLength = 220;
const concise = (description: string, limit: number) =>
  description.length > limit
    ? `${description.slice(0, limit - 1)}…`
    : description;

export function AgentGrid({ agents }: { agents: PublicMarketplaceAgent[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedDescription, setExpandedDescription] =
    useState<PublicMarketplaceAgent | null>(null);
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
          <article className="agent-result-row" key={agent.id}>
            <Link href={`/agents/${agent.id}`} className="agent-result-main">
              <AgentAvatar
                id={agent.id}
                imageUrl={agent.imageUrl}
                name={agent.name}
              />
              <div>
                <h3>{agent.name}</h3>
                <p className="agent-result-provider">
                  {productCapabilityLabel(agent.serviceCapability ?? agent.category)} · Agent #{agent.externalAgentId}
                  <span className="agent-result-network">{agent.network}</span>
                </p>
                <p className="agent-description agent-description-desktop">
                  {concise(agent.description, desktopDescriptionPreviewLength)}
                </p>
                <p className="agent-description agent-description-mobile">
                  {concise(agent.description, mobileDescriptionPreviewLength)}
                </p>
                {agent.description.length > desktopDescriptionPreviewLength ? (
                  <Button
                    className="description-expand description-expand-desktop"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setExpandedDescription(agent)}
                  >
                    View full description
                  </Button>
                ) : null}
                {agent.description.length > mobileDescriptionPreviewLength ? (
                  <Button
                    className="description-expand description-expand-mobile"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setExpandedDescription(agent)}
                  >
                    View full description
                  </Button>
                ) : null}
                <div className="agent-card-tags">
                  <span>Verified service</span>
                  {agent.protocols.slice(0, 2).map((protocol) => (
                    <span key={protocol}>{productCapabilityLabel(protocol)}</span>
                  ))}
                  {agent.hireable ? <span>Active offer</span> : null}
                </div>
              </div>
            </Link>
            <dl className="agent-card-metrics agent-result-metrics">
              <div>
                <dt>Completed jobs</dt>
                <dd>
                  {agent.completionRatePercent === null
                    ? "No job history yet"
                    : `${agent.completedCommerceJobCount} completed · ${agent.completionRatePercent}%`}
                </dd>
              </div>
              <div>
                <dt>Verified</dt>
                <dd>{relativeTime(agent.lastVerifiedAt)}</dd>
              </div>
              <div>
                <dt>Offer</dt>
                <dd>{marketplacePriceLabel(agent.activeOfferPrice)}</dd>
              </div>
              <div>
                <dt>Reviews</dt>
                <dd>
                  {agent.reviewCount > 0
                    ? `${agent.reviewGoodCount} good · ${agent.reviewBadCount} bad`
                    : "No verified reviews yet"}
                </dd>
              </div>
            </dl>
            <div className="agent-result-actions">
              {agent.hireable ? (
                <>
                  <label className="compare-check">
                    <input
                      type="checkbox"
                      checked={selected.includes(agent.id)}
                      onChange={() => toggle(agent.id)}
                    />
                    Compare
                  </label>
                  <Link href={`/agents/${agent.id}`} className="secondary-button">
                    Details
                  </Link>
                  <HireLink
                    href={`/agents/${agent.id}/hire`}
                    className="primary-button"
                  >
                    Hire
                  </HireLink>
                </>
              ) : (
                <>
                  <span className="unavailable-copy">Not currently hireable</span>
                  <Link href={`/agents/${agent.id}`} className="secondary-button">
                    Details
                  </Link>
                </>
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
      <Dialog
        open={expandedDescription !== null}
        onOpenChange={(open) => {
          if (!open) setExpandedDescription(null);
        }}
      >
        {expandedDescription === null ? null : (
          <DialogContent className="marketplace-description-dialog">
            <DialogHeader>
              <span className="overline">Service description</span>
              <DialogTitle>
                {productCapabilityLabel(
                  expandedDescription.serviceCapability ?? expandedDescription.category,
                )}
              </DialogTitle>
              <p className="agent-result-provider">
                Provided by {expandedDescription.name}
              </p>
            </DialogHeader>
            <DialogDescription>
              {expandedDescription.description}
            </DialogDescription>
            <DialogFooter>
              <Button type="button" onClick={() => setExpandedDescription(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
