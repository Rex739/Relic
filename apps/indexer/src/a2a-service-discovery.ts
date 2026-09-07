import { z } from "zod";

import { safeHttpRequest } from "./endpoint-observer.js";

const agentCardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.url(),
  protocolVersion: z.string().min(1),
  skills: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  ),
});

type SafeRequester = typeof safeHttpRequest;

export type A2aEndpointResolution =
  | {
      readonly status: "resolved";
      readonly discoveryUrl: string;
      readonly invocationUrl: string;
      readonly categoryTerms: readonly string[];
    }
  | {
      readonly status: "unresolved";
      readonly discoveryUrl: string;
      readonly reason: string;
    };

function cardUrlFor(endpoint: string) {
  const url = new URL(endpoint);
  if (url.pathname.toLowerCase().endsWith("/agent-card.json"))
    return url.toString();
  url.pathname = "/.well-known/agent-card.json";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * An ERC-8004 service may register an A2A card URL rather than the JSON-RPC
 * invocation URL. Resolve the latter from the card; never infer a suffix such
 * as `/apex`, because the card is the protocol authority for that value.
 */
export async function resolveA2aInvocationEndpoint(
  discoveryEndpoint: string,
  request: SafeRequester = safeHttpRequest,
): Promise<A2aEndpointResolution> {
  let discoveryUrl: string;
  try {
    discoveryUrl = cardUrlFor(discoveryEndpoint);
  } catch {
    return {
      status: "unresolved",
      discoveryUrl: discoveryEndpoint,
      reason: "invalid_discovery_url",
    };
  }

  try {
    const response = await request(discoveryUrl, {
      method: "GET",
      timeoutMs: 5_000,
      maxRedirects: 2,
      maxResponseBytes: 64 * 1024,
    });
    if (!response.ok || response.status !== 200)
      return {
        status: "unresolved",
        discoveryUrl,
        reason: "agent_card_unavailable",
      };
    const card = agentCardSchema.parse(JSON.parse(response.body));
    const invocation = new URL(card.url);
    const cardOrigin = new URL(discoveryUrl).origin;
    if (invocation.protocol !== "https:" || invocation.origin !== cardOrigin)
      return {
        status: "unresolved",
        discoveryUrl,
        reason: "agent_card_invocation_url_outside_origin",
      };
    return {
      status: "resolved",
      discoveryUrl,
      invocationUrl: invocation.toString(),
      categoryTerms: [
        card.name,
        ...(card.description === undefined ? [] : [card.description]),
        ...card.skills.flatMap((skill) => [
          skill.id,
          ...(skill.name === undefined ? [] : [skill.name]),
          ...(skill.description === undefined ? [] : [skill.description]),
          ...(skill.tags ?? []),
        ]),
      ],
    };
  } catch {
    return {
      status: "unresolved",
      discoveryUrl,
      reason: "agent_card_invalid",
    };
  }
}
