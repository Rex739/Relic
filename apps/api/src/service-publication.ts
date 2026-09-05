import { randomUUID } from "node:crypto";

import { DrizzleSupplyStore } from "@relic/database";
import { negotiateOfferBoundService } from "@relic/validation";

/**
 * Runs the one safe, protocol-specific publication check shared by every
 * seller. It obtains a quote for the exact offer price but never creates a
 * job, moves funds, or submits a transaction.
 */
export class ServicePublicationVerifier {
  public constructor(private readonly supply: DrizzleSupplyStore) {}

  public async verify(input: {
    id: string;
    agentId: string;
    serviceId: string;
    version: {
      id: string;
      capability: string;
      terms: string;
      termsHash: string;
      limitationsSnapshot: string[];
      chainId: number;
      price: {
        amountBaseUnits: string;
        tokenAddress: `0x${string}`;
      };
    };
  }) {
    const selected = await this.supply.findServiceCandidate(input.serviceId);
    if (selected === null || selected.service.agentId !== input.agentId)
      throw new Error("The offer service is no longer available for publication");
    if (
      selected.service.availability !== "available" ||
      selected.service.endpoint === null
    )
      throw new Error("The public service endpoint is not currently available");

    const protocol = selected.service.interfaceProtocol.toLowerCase();
    const preflightId = randomUUID();
    try {
      const negotiated = await negotiateOfferBoundService({
        endpoint: selected.service.endpoint,
        interfaceProtocol: protocol,
        // There is no buyer agreement during publication. This stable UUID is
        // only retained for provider compatibility; the explicit purpose flag
        // prevents it from being interpreted as buyer commerce.
        agreementId: preflightId,
        offerId: input.id,
        offerVersionId: input.version.id,
        capability: input.version.capability,
        terms: input.version.terms,
        termsHash: input.version.termsHash,
        limitations: input.version.limitationsSnapshot,
        chainId: input.version.chainId,
        amountBaseUnits: input.version.price.amountBaseUnits,
        paymentTokenAddress: input.version.price.tokenAddress,
        purpose: "publication_preflight",
        preflightId,
      });
      const evidence = {
        dataKind: "relic-publication-preflight",
        purpose: "publication_preflight",
        protocol,
        operation: "negotiate",
        offerId: input.id,
        offerVersionId: input.version.id,
        preflightId,
        taskId: negotiated.taskId,
        contextId: negotiated.contextId,
        requestMessageId: negotiated.messageId,
        requestHash: negotiated.quote.request_hash,
        responseHash: negotiated.quote.response_hash,
        negotiationHash: negotiated.quote.negotiation_hash,
        providerSignature: negotiated.quote.provider_sig,
        verifyingContract: negotiated.quote.verifying_contract,
        price: negotiated.quote.response.terms.price,
        currency: negotiated.quote.response.terms.currency,
        responseSha256: negotiated.responseSha256,
        jobCreated: false,
        paymentSent: false,
        transactionAttempted: false,
      };
      await this.supply.recordServiceVerification({
        serviceId: selected.service.id,
        fromLevel: selected.service.verificationLevel,
        toLevel: "INVOCATION_VERIFIED",
        result: "passed",
        protocol,
        requestMethod: "POST",
        availability: "available",
        evidence,
      });
      if (selected.candidate.status === "SERVICE_OBSERVED")
        await this.supply.transitionCandidate({
          candidateId: selected.candidate.id,
          from: "SERVICE_OBSERVED",
          to: "INVOCATION_VERIFIED",
          evidence,
        });
      // A successful publication preflight is the final safe readiness gate:
      // Relic reached the public endpoint and received a quote for this exact
      // offer. Promote the candidate so the public marketplace and seller UI
      // use the same definition of "ready to hire".
      if (
        selected.candidate.status === "SERVICE_OBSERVED" ||
        selected.candidate.status === "INVOCATION_VERIFIED"
      )
        await this.supply.transitionCandidate({
          candidateId: selected.candidate.id,
          from: "INVOCATION_VERIFIED",
          to: "ACTIONABLE",
          evidence,
        });
      await this.supply.setListingHireable({
        serviceId: selected.service.id,
        hireable: true,
        reasons: ["Public endpoint and exact offer price verified by Relic."],
      });
      return evidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.supply.recordServiceVerification({
        serviceId: selected.service.id,
        fromLevel: selected.service.verificationLevel,
        toLevel: "INVOCATION_VERIFIED",
        result: "failed",
        protocol,
        requestMethod: "POST",
        availability: "available",
        evidence: {
          dataKind: "relic-publication-preflight",
          purpose: "publication_preflight",
          offerId: input.id,
          offerVersionId: input.version.id,
          preflightId,
          jobCreated: false,
          paymentSent: false,
          transactionAttempted: false,
        },
        error,
      });
      await this.supply.setListingHireable({
        serviceId: selected.service.id,
        hireable: false,
        reasons: ["Relic could not verify this offer against the public endpoint.", message],
      });
      throw new Error(`Relic could not publish this offer: ${message}`);
    }
  }
}
