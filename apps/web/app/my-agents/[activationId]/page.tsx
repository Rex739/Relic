import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { ExecutionRecord, PolicyReason } from "@relic/domain";

import { agreements, type CommerceAgreementView } from "../../../lib/commerce";
import { commercePriceLabel, isFreePrice } from "../../../lib/commerce-display";
import { getMandate, listExecutions } from "../../../lib/mandates";
import { marketplaceAgent, relativeTime } from "../../../lib/marketplace";
import {
  relationshipSetupComplete,
  relationshipStatus,
  selectRelationshipAgreement,
} from "../../../lib/relationship-status";
import {
  requestForbiddenTransfer,
  requestHealthObservation,
} from "../../execution-actions";
import { transitionMandateAction } from "../../mandate-actions";
import { prepareCommerceActivationAction } from "../../commerce-actions";
import { CommerceAuthorization } from "../../_components/commerce-authorization";
import { WalletCommerceOperation } from "../../_components/wallet-commerce-operation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Active agent" };
const ACTIVATION_SETUP_AUTHORIZATION_HEADROOM_MS = 12 * 60_000;

const sentenceCase = (value: string) => {
  const sentence = value.replaceAll("_", " ").toLowerCase();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
};

const friendlyReason = (reason: PolicyReason) => {
  switch (reason.code) {
    case "mandate_paused":
      return "This relationship is paused, so Relic blocked the request.";
    case "mandate_revoked":
      return "This relationship has been revoked, so Relic blocked the request.";
    case "mandate_expired":
    case "execution_expired":
      return "The mandate or action deadline has expired.";
    case "capability_not_authorized":
      return "The requested capability is outside this mandate.";
    case "asset_not_authorized":
      return "The requested asset is not permitted by this mandate.";
    case "protocol_not_authorized":
      return "The requested protocol is not permitted by this mandate.";
    case "contract_not_authorized":
      return "The target is not an approved contract or service.";
    case "observe_only":
      return "This relationship permits observation only—not transactions.";
    case "network_mismatch":
      return "The requested network does not match the verified service.";
    case "stale_agent":
    case "service_changed":
      return "The agent's current service evidence no longer matches the mandate.";
    case "per_action_limit_exceeded":
      return "The request exceeds the per-action allowance.";
    case "aggregate_limit_exceeded":
      return "The request exceeds the remaining aggregate allowance.";
    case "frequency_limit_exceeded":
      return "The request exceeds the mandate's frequency limit.";
    case "mandate_version_mismatch":
      return "The request is bound to an inactive mandate version.";
    case "policy_satisfied":
      return "The request matched the active mandate's verified service, network, capability, and limits.";
    case "explicit_action_approval_required":
      return "The request is within the mandate, but this exact action still needs explicit approval.";
    default:
      return "Relic blocked this request because it did not satisfy the active safety policy.";
  }
};

const humanizedReasons = (reasons: PolicyReason[]) =>
  [...new Set(reasons.map(friendlyReason))].join(" ");

const outcomeRecord = (execution: ExecutionRecord) =>
  execution.receipt?.outcome ?? {};

const executionPresentation = (execution: ExecutionRecord) => {
  const outcome = outcomeRecord(execution);
  const succeeded = execution.status === "SUCCEEDED";
  const denied = execution.status === "DENIED";
  const failed = execution.status === "FAILED";
  const readOnly = execution.action.transactional === false;
  const safetyValidation =
    execution.action.source.kind ===
    "execution_room_forbidden_action_validation";
  const noPosition = outcome.noPosition === true;
  const enteredMarketCount =
    typeof outcome.enteredMarketCount === "number"
      ? outcome.enteredMarketCount
      : null;
  const riskLevel =
    typeof outcome.riskLevel === "string" ? outcome.riskLevel : null;
  const observedProtocol =
    typeof outcome.protocol === "string"
      ? outcome.protocol
      : execution.action.protocol;

  let result = sentenceCase(execution.status);
  if (denied && safetyValidation)
    result = "Safety check passed — token transfer blocked";
  else if (denied) result = "Request blocked before execution";
  else if (failed) result = "The requested check could not be completed";
  else if (succeeded && noPosition)
    result = "No active Venus lending position was found";
  else if (
    succeeded &&
    observedProtocol?.toLowerCase().includes("venus") &&
    enteredMarketCount !== null
  )
    result = `Active Venus position found in ${enteredMarketCount} ${enteredMarketCount === 1 ? "market" : "markets"}`;
  else if (succeeded) result = "The requested check completed successfully";
  else if (execution.status === "APPROVAL_REQUIRED")
    result = "Waiting for explicit approval";

  let risk = sentenceCase(execution.status);
  if (denied && safetyValidation) risk = "Protection confirmed";
  else if (denied) risk = "Protected by policy";
  else if (failed) risk = "Result unavailable";
  else if (noPosition) risk = "No active position";
  else if (riskLevel === "critical") risk = "Shortfall detected";
  else if (riskLevel === "none") risk = "No shortfall detected";
  else if (riskLevel !== null) risk = sentenceCase(riskLevel);
  else if (succeeded) risk = "Check completed";

  let action = sentenceCase(execution.action.actionType);
  if (denied && safetyValidation)
    action =
      "Tested whether the observe-only mandate would permit a token transfer";
  else if (denied)
    action = `Evaluated ${sentenceCase(execution.action.actionType).toLowerCase()} against the mandate`;
  else if (readOnly && observedProtocol?.toLowerCase().includes("venus"))
    action = "Checked the supplied public address for a Venus Core position";

  let funds = "Not established";
  if (readOnly) funds = "No — this was a read-only check";
  else if (outcome.fundsMoved === true)
    funds = "Yes — recorded by the provider";
  else if (outcome.fundsMoved === false)
    funds = "No — recorded by the provider";
  else if (denied) funds = "No — execution was blocked";

  let why = humanizedReasons(execution.reasons);
  if (why.length === 0 && execution.decision === "ALLOW")
    why =
      "The request matched the active mandate, verified service, network, and policy limits.";
  if (why.length === 0 && execution.decision === "REQUIRE_APPROVAL")
    why = "The mandate requires explicit approval for this exact action.";
  if (why.length === 0) why = "Relic has not recorded a policy decision yet.";

  let context = "Relic has persisted this request and its policy state.";
  if (denied && safetyValidation)
    context =
      "Relic confirmed the mandate stopped this forbidden action before signing or execution.";
  else if (denied) context = "Relic stopped this before the agent could act.";
  else if (failed) context = "No successful result was persisted.";
  else if (
    succeeded &&
    !noPosition &&
    enteredMarketCount !== null &&
    riskLevel === "none"
  )
    context = `Venus reports ${enteredMarketCount} entered ${enteredMarketCount === 1 ? "market" : "markets"} and no account shortfall at the observed block.`;
  else if (execution.receipt?.source === "independently_observed")
    context = "Relic independently observed this result.";
  else if (execution.receipt?.source === "onchain_verified")
    context = "Relic verified this result onchain.";
  else if (execution.receipt?.source === "provider_reported")
    context =
      "The provider reported this result; technical evidence shows its source.";

  return {
    action,
    context,
    funds,
    result,
    risk,
    why,
    statusLabel:
      denied && safetyValidation
        ? "Safety check passed"
        : sentenceCase(execution.status),
    decisionLabel:
      denied && safetyValidation
        ? "BLOCKED"
        : (execution.decision ?? "PENDING"),
  };
};

export default async function ExecutionRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ activationId: string }>;
  searchParams: Promise<{ exactAuthorizationId?: string }>;
}) {
  const { activationId } = await params;
  const { exactAuthorizationId: requestedRecoveryAuthorizationId } =
    await searchParams;
  let mandate;
  let executions;
  try {
    [mandate, executions] = await Promise.all([
      getMandate(activationId),
      listExecutions(activationId),
    ]);
  } catch {
    notFound();
  }
  const walletAuthenticated =
    (await cookies()).get("relic_session")?.value !== undefined;
  const agentResponse = await marketplaceAgent(mandate.agentId);
  const agentName = agentResponse.data?.name ?? "Active agent";
  let commerceAgreement: CommerceAgreementView | null = null;
  if (walletAuthenticated) {
    try {
      const matchingAgreements = (await agreements()).filter(
        (item): item is CommerceAgreementView =>
          item !== null && item.mandateId === mandate.id,
      );
      commerceAgreement = selectRelationshipAgreement(
        matchingAgreements,
        mandate.id,
      );
    } catch {
      commerceAgreement = null;
    }
  }
  const latest = executions[0] ?? null;
  const attemptedCommerceExecutionIds = new Set(
    commerceAgreement?.operations
      .filter(
        (operation) =>
          typeof operation.activationId === "string" &&
          typeof operation.executionRequestId === "string",
      )
      .map((operation) => String(operation.executionRequestId)) ?? [],
  );
  const freshReplacementExecution =
    latest?.status === "SUCCEEDED" &&
    !attemptedCommerceExecutionIds.has(latest.id);
  const latestObservedAccount = latest?.action.parameters.account;
  const recoveryObservedAccount =
    typeof latestObservedAccount === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(latestObservedAccount)
      ? latestObservedAccount
      : undefined;
  const awaitingActionOperation = commerceAgreement?.operations
    .toReversed()
    .find(
      (operation) =>
        (operation.state === "AWAITING_SIGNATURE" ||
          operation.state === "SUBMITTED" ||
          operation.state === "PENDING" ||
          operation.state === "CONFIRMED") &&
        typeof operation.executionRequestId === "string" &&
        (operation.operationType === "CREATE_JOB" ||
          operation.operationType === "REGISTER_JOB" ||
          operation.operationType === "SET_BUDGET" ||
          operation.operationType === "FUND"),
    );
  const commerceExecution = executions.find(
    (execution) => execution.id === awaitingActionOperation?.executionRequestId,
  );
  const awaitingOperationEvidence = awaitingActionOperation?.evidence as
    Record<string, unknown> | undefined;
  const operationQuoteExpiresAt = awaitingOperationEvidence?.quoteExpiresAt;
  const operationNegotiatedAt = awaitingOperationEvidence?.negotiatedAt;
  const initialQuoteExpiresAt =
    typeof operationQuoteExpiresAt === "number"
      ? new Date(operationQuoteExpiresAt * 1_000).toISOString()
      : undefined;
  const initialQuoteNegotiatedAt =
    typeof operationNegotiatedAt === "number"
      ? new Date(operationNegotiatedAt * 1_000).toISOString()
      : undefined;
  const awaitingOperationType = awaitingActionOperation?.operationType;
  const operationAuthorizationId =
    awaitingOperationEvidence?.exactActionAuthorizationId;
  const operationAuthorizationExpiry =
    awaitingOperationEvidence?.authorizationExpiresAt;
  const operationActionHash = awaitingOperationEvidence?.actionHash;
  const expectedActionHash = commerceExecution?.action.normalizedHash;
  const latestExactAuthorizationId =
    typeof operationAuthorizationId === "string" &&
    typeof operationAuthorizationExpiry === "string" &&
    Date.parse(operationAuthorizationExpiry) >
      Date.now() + ACTIVATION_SETUP_AUTHORIZATION_HEADROOM_MS &&
    typeof operationActionHash === "string" &&
    expectedActionHash !== undefined &&
    operationActionHash.replace(/^0x/, "").toLowerCase() ===
      expectedActionHash.replace(/^0x/, "").toLowerCase()
      ? operationAuthorizationId
      : undefined;
  const persistedRecoveryAuthorization = commerceAgreement?.authorizations
    .toReversed()
    .find(
      (authorization) =>
        authorization.executionRequestId === latest?.id &&
        authorization.verificationStatus === "VERIFIED" &&
        authorization.revokedAt === null &&
        Date.parse(authorization.expiresAt) >
          Date.now() + ACTIVATION_SETUP_AUTHORIZATION_HEADROOM_MS &&
        authorization.actionHash !== null &&
        latest !== null &&
        authorization.actionHash.replace(/^0x/, "").toLowerCase() ===
          latest.action.normalizedHash.replace(/^0x/, "").toLowerCase(),
    );
  const recoveryAuthorizationId =
    persistedRecoveryAuthorization !== undefined &&
    (requestedRecoveryAuthorizationId === undefined ||
      requestedRecoveryAuthorizationId === persistedRecoveryAuthorization.id)
      ? persistedRecoveryAuthorization.id
      : undefined;
  const movementBaseUnits = (movement: Record<string, unknown>) => {
    const value = movement.amountBaseUnits;
    if (typeof value !== "string" || !/^\d+$/.test(value))
      throw new Error("Commerce movement is missing an exact base-unit amount");
    return BigInt(value);
  };
  const movementTotal = (types: string[]) =>
    commerceAgreement?.movements
      .filter((movement) => types.includes(String(movement.movementType)))
      .reduce((total, movement) => total + movementBaseUnits(movement), 0n) ??
    0n;
  const setupComplete = relationshipSetupComplete(commerceAgreement);
  const latestPresentation =
    latest === null ? null : executionPresentation(latest);
  const relationshipState = relationshipStatus({
    mandate,
    agreement: commerceAgreement,
  });
  return (
    <main className="page-shell execution-room">
      <nav className="breadcrumbs">
        <Link href="/my-agents">My Agents</Link>
        <span>/</span>
        <span>Active agent</span>
      </nav>
      <header className="execution-room-header">
        <div>
          <span className="overline">{relationshipState}</span>
          <h1>{agentName}</h1>
          <p>{mandate.version.objective}</p>
        </div>
        <aside
          className={`execution-state ${mandate.attentionReason ? "attention" : ""}`}
        >
          <span>Current status</span>
          <strong>{relationshipState.toUpperCase()}</strong>
          <small>
            BNB Chain Testnet ·{" "}
            {mandate.version.approvalMode.replaceAll("_", " ")}
          </small>
        </aside>
      </header>

      {relationshipState === "Running" ? (
        <section className="running-overview" aria-label="Agent overview">
          <div>
            <span className="overline">Overview</span>
            <h2>Your agent is running</h2>
            <p>{mandate.version.objective}</p>
          </div>
          <dl>
            <div>
              <dt>Doing now</dt>
              <dd>Read-only Venus monitoring</dd>
            </div>
            <div>
              <dt>Latest result</dt>
              <dd>
                {latestPresentation?.result ?? "Waiting for first observation"}
              </dd>
            </div>
            <div>
              <dt>Permissions</dt>
              <dd>{mandate.version.approvalMode.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Service price</dt>
              <dd>
                {commerceAgreement === null
                  ? "Unavailable"
                  : commercePriceLabel(commerceAgreement.pricingSnapshot)}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {setupComplete && relationshipState !== "Running" ? (
        <section className="running-overview" aria-label="Relationship status">
          <div>
            <span className="overline">Relationship status</span>
            <h2>{relationshipState}</h2>
            <p>
              Setup is complete. Review the current status and available
              controls below.
            </p>
          </div>
        </section>
      ) : null}

      {commerceAgreement === null || setupComplete ? null : (
        <section className="execution-commerce-context">
          <div>
            <span className="overline">Service setup</span>
            <h2>
              {commerceAgreement.status === "ACTIVE"
                ? "Ready to run"
                : sentenceCase(commerceAgreement.status)}
            </h2>
            <p>
              Relic keeps permissions and wallet confirmations separate so the
              agent cannot exceed the limits you approved.
            </p>
          </div>
          <dl className="commerce-facts">
            <div>
              <dt>Service price</dt>
              <dd>{commercePriceLabel(commerceAgreement.pricingSnapshot)}</dd>
            </div>
            <div>
              <dt>Permissions</dt>
              <dd>
                {commerceAgreement.authorizationArtifactId === null
                  ? "Confirmation required"
                  : "Confirmed"}
              </dd>
            </div>
            <div>
              <dt>Funded</dt>
              <dd>
                {isFreePrice(commerceAgreement.pricingSnapshot)
                  ? "None"
                  : commercePriceLabel({
                      ...commerceAgreement.pricingSnapshot,
                      amountBaseUnits: movementTotal([
                        "FUNDING",
                        "ESCROW_LOCK",
                      ]).toString(),
                    })}
              </dd>
            </div>
            <div>
              <dt>Settled</dt>
              <dd>
                {isFreePrice(commerceAgreement.pricingSnapshot)
                  ? "None"
                  : commercePriceLabel({
                      ...commerceAgreement.pricingSnapshot,
                      amountBaseUnits: movementTotal([
                        "PAYMENT",
                        "ESCROW_RELEASE",
                      ]).toString(),
                    })}
              </dd>
            </div>
            <div>
              <dt>Refunded</dt>
              <dd>
                {isFreePrice(commerceAgreement.pricingSnapshot)
                  ? "None"
                  : commercePriceLabel({
                      ...commerceAgreement.pricingSnapshot,
                      amountBaseUnits: movementTotal(["REFUND"]).toString(),
                    })}
              </dd>
            </div>
            <div>
              <dt>Setup progress</dt>
              <dd>
                {commerceAgreement.operations.length} recorded ·{" "}
                {
                  commerceAgreement.operations.filter(
                    (operation) => operation.state === "AWAITING_SIGNATURE",
                  ).length
                }{" "}
                awaiting confirmation
              </dd>
            </div>
          </dl>
          <Link href={`/commerce/agreements/${commerceAgreement.id}`}>
            View technical setup details →
          </Link>
          {commerceExecution?.status === "SUCCEEDED" &&
          awaitingOperationType === "CREATE_JOB" ? (
            <div className="authorization-action">
              <strong>Confirm this run</strong>
              <p>
                Confirm the exact target and permissions for this run. This
                signature does not move funds.
              </p>
              {latestExactAuthorizationId === undefined ? (
                <CommerceAuthorization
                  agreementId={commerceAgreement.id}
                  continuationHref={`/my-agents/mandates/${mandate.id}`}
                  actionHash={`0x${commerceExecution.action.normalizedHash.replace(/^0x/, "")}`}
                />
              ) : (
                <p>
                  Exact-action signature verified and persisted as artifact{" "}
                  <code>{latestExactAuthorizationId}</code>.
                </p>
              )}
            </div>
          ) : null}
          {awaitingActionOperation !== undefined &&
          (awaitingOperationType === "REGISTER_JOB" ||
            awaitingOperationType === "SET_BUDGET" ||
            awaitingOperationType === "FUND" ||
            (awaitingOperationType === "CREATE_JOB" &&
              latestExactAuthorizationId !== undefined)) ? (
            <div className="authorization-action">
              <strong>
                {awaitingOperationType === "REGISTER_JOB"
                  ? "Continue secure setup"
                  : awaitingOperationType === "SET_BUDGET"
                    ? "Confirm the free service limit"
                    : awaitingOperationType === "FUND"
                      ? "Start the free service"
                      : "Start agent setup"}
              </strong>
              <p>
                {awaitingOperationType === "REGISTER_JOB"
                  ? "Apply the approved safety policy. No service funds move; BSC Testnet gas only."
                  : awaitingOperationType === "SET_BUDGET"
                    ? "Confirm the service remains free. No tokens move; BSC Testnet gas only."
                    : awaitingOperationType === "FUND"
                      ? "Finish setup and put the agent in its ready state. No service funds move; BSC Testnet gas only."
                      : "Relic checks your permissions, the live service, and the selected network immediately before opening your wallet."}
              </p>
              <WalletCommerceOperation
                agreementId={commerceAgreement.id}
                operationId={String(awaitingActionOperation.id)}
                operationType={awaitingOperationType}
                operationState={
                  awaitingActionOperation.state as
                    "AWAITING_SIGNATURE" | "SUBMITTED" | "PENDING" | "CONFIRMED"
                }
                {...(initialQuoteExpiresAt === undefined
                  ? {}
                  : { initialQuoteExpiresAt })}
                {...(initialQuoteNegotiatedAt === undefined
                  ? {}
                  : { initialQuoteNegotiatedAt })}
              />
            </div>
          ) : null}
          {commerceAgreement.status === "AUTHORIZED" &&
          commerceAgreement.authorizationArtifactId !== null &&
          commerceAgreement.operations.length === 0 &&
          latest?.status === "SUCCEEDED" ? (
            <form action={prepareCommerceActivationAction}>
              <input
                type="hidden"
                name="agreementId"
                value={commerceAgreement.id}
              />
              <input
                type="hidden"
                name="executionRequestId"
                value={latest.id}
              />
              <input
                type="hidden"
                name="authorizationId"
                value={commerceAgreement.authorizationArtifactId}
              />
              <button type="submit">
                Prepare setup session <span>→</span>
              </button>
              <small>
                Creates durable offchain preparation only. It does not request a
                wallet transaction or write to BSC Testnet.
              </small>
            </form>
          ) : null}
          {commerceAgreement.status === "ACTIVE" &&
          awaitingActionOperation === undefined &&
          latest?.status === "SUCCEEDED" ? (
            <div className="authorization-action">
              <strong>Start a fresh quote-bound attempt</strong>
              <p>
                A previous setup window expired before all confirmations were
                complete. Relic preserved that attempt as history and will not
                advance it. Continue with a fresh observation and time-bound
                setup under the same approved relationship.
              </p>
              {!freshReplacementExecution ? (
                <>
                  <p>
                    First, create a fresh policy-controlled observation for the
                    same public account. Relic will then offer exact-action
                    approval before requesting the time-limited seller quote.
                  </p>
                  {recoveryObservedAccount === undefined ? (
                    <a className="button-link" href="#request-observation">
                      Continue to fresh observation <span>→</span>
                    </a>
                  ) : (
                    <form
                      action={requestHealthObservation.bind(null, mandate.id)}
                    >
                      <input
                        type="hidden"
                        name="account"
                        value={recoveryObservedAccount}
                      />
                      <button type="submit">
                        Run fresh observation <span>→</span>
                      </button>
                      <small>
                        Read-only BSC Testnet check for{" "}
                        {recoveryObservedAccount}. No wallet signature,
                        transaction, or funds are involved.
                      </small>
                    </form>
                  )}
                </>
              ) : recoveryAuthorizationId === undefined ? (
                <CommerceAuthorization
                  agreementId={commerceAgreement.id}
                  continuationHref={`/my-agents/mandates/${mandate.id}`}
                  actionHash={`0x${latest.action.normalizedHash.replace(/^0x/, "")}`}
                />
              ) : (
                <form action={prepareCommerceActivationAction}>
                  <input
                    type="hidden"
                    name="agreementId"
                    value={commerceAgreement.id}
                  />
                  <input
                    type="hidden"
                    name="executionRequestId"
                    value={latest.id}
                  />
                  <input
                    type="hidden"
                    name="authorizationId"
                    value={recoveryAuthorizationId}
                  />
                  <input type="hidden" name="mandateId" value={mandate.id} />
                  <button type="submit">
                    Prepare activation setup session <span>→</span>
                  </button>
                  <small>
                    Offchain preparation only. Relic will request a fresh
                    SDK-signed quote and require at least 12 minutes of
                    remaining setup time before showing the first wallet
                    confirmation. It creates no blockchain job and moves no
                    funds.
                  </small>
                </form>
              )}
            </div>
          ) : null}
        </section>
      )}

      <section className="execution-console-grid">
        <div className="execution-feed">
          <span className="overline">Activity</span>
          <h2>Latest results</h2>
          {executions.length === 0 ? (
            <div className="empty-relationships">
              <h3>No execution requested yet.</h3>
              <p>
                Start a bounded read-only observation. No wallet or transaction
                is involved.
              </p>
            </div>
          ) : (
            executions.map((execution) => {
              const presentation = executionPresentation(execution);
              return (
                <article className="execution-event" key={execution.id}>
                  <div
                    className={`decision-mark ${execution.decision?.toLowerCase() ?? "pending"}`}
                  />
                  <div>
                    <div className="event-heading">
                      <b>{sentenceCase(execution.action.actionType)}</b>
                      <span>{relativeTime(execution.updatedAt)}</span>
                    </div>
                    <div className="execution-status-line">
                      <strong>{presentation.statusLabel}</strong>
                      <span>{presentation.decisionLabel}</span>
                    </div>
                    <section
                      className="execution-summary"
                      aria-label="Result summary"
                    >
                      <div className="execution-summary-lead">
                        <span>Result</span>
                        <strong>{presentation.result}</strong>
                        <p>{presentation.context}</p>
                      </div>
                      <dl>
                        <div>
                          <dt>Risk / status</dt>
                          <dd>{presentation.risk}</dd>
                        </div>
                        <div>
                          <dt>Action performed</dt>
                          <dd>{presentation.action}</dd>
                        </div>
                        <div>
                          <dt>Funds moved</dt>
                          <dd>{presentation.funds}</dd>
                        </div>
                        <div>
                          <dt>Why Relic decided this</dt>
                          <dd>{presentation.why}</dd>
                        </div>
                      </dl>
                    </section>
                    <details className="execution-technical">
                      <summary>Technical evidence</summary>
                      <dl>
                        <div>
                          <dt>Execution ID</dt>
                          <dd>{execution.id}</dd>
                        </div>
                        <div>
                          <dt>Mandate ID</dt>
                          <dd>{execution.mandateId}</dd>
                        </div>
                        <div>
                          <dt>Principal ID</dt>
                          <dd>{execution.principalId}</dd>
                        </div>
                        <div>
                          <dt>Action hash</dt>
                          <dd>{execution.action.normalizedHash}</dd>
                        </div>
                        <div>
                          <dt>Network</dt>
                          <dd>Chain {execution.chainId}</dd>
                        </div>
                        <div>
                          <dt>Protocol</dt>
                          <dd>{execution.action.protocol ?? "None"}</dd>
                        </div>
                        <div>
                          <dt>Cost</dt>
                          <dd>{execution.receipt?.cost ?? "Not incurred"}</dd>
                        </div>
                      </dl>
                      <div className="raw-evidence-block">
                        <b>Exact policy reasons</b>
                        <pre>{JSON.stringify(execution.reasons, null, 2)}</pre>
                      </div>
                      <div className="raw-evidence-block">
                        <b>Canonical action</b>
                        <pre>{JSON.stringify(execution.action, null, 2)}</pre>
                      </div>
                      <div className="raw-evidence-block">
                        <b>Raw request</b>
                        <pre>
                          {JSON.stringify(execution.rawRequest, null, 2)}
                        </pre>
                      </div>
                      <div className="raw-evidence-block">
                        <b>Complete persisted receipt</b>
                        <pre>{JSON.stringify(execution.receipt, null, 2)}</pre>
                      </div>
                    </details>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <aside className="execution-sidebar">
          <section>
            <span className="overline">Permissions</span>
            <h2>{mandate.version.approvalMode.replaceAll("_", " ")}</h2>
            <p>
              Read-only monitoring. No asset, spending, wallet, or transaction
              authority.
            </p>
            <dl>
              <div>
                <dt>Version</dt>
                <dd>{mandate.currentVersion}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{new Date(mandate.version.expiresAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Last execution</dt>
                <dd>{latest ? relativeTime(latest.updatedAt) : "None"}</dd>
              </div>
              <div>
                <dt>Latest result</dt>
                <dd>
                  {latest === null
                    ? "None"
                    : executionPresentation(latest).result}
                </dd>
              </div>
            </dl>
          </section>
          <section id="request-observation">
            <span className="overline">Request observation</span>
            <form
              action={requestHealthObservation.bind(null, mandate.id)}
              className="execution-request-form"
            >
              <label>
                Public address to observe
                <input
                  name="account"
                  required
                  pattern="0x[0-9a-fA-F]{40}"
                  placeholder="0x…"
                />
              </label>
              <button
                className="primary-action"
                disabled={mandate.status !== "ACTIVE"}
              >
                Run policy-controlled check <span>→</span>
              </button>
            </form>
            <small>
              Direct read-only BSC Testnet evidence. No signing and no
              blockchain write.
            </small>
          </section>
          <section className="execution-controls">
            <span className="overline">Controls</span>
            <Link href={`/mandates/${mandate.id}`}>Manage permissions</Link>
            {mandate.status === "ACTIVE" ? (
              <form
                action={transitionMandateAction.bind(null, mandate.id, "pause")}
              >
                <button>Pause</button>
              </form>
            ) : null}
            {mandate.status === "PAUSED" ? (
              <form
                action={transitionMandateAction.bind(
                  null,
                  mandate.id,
                  "resume",
                )}
              >
                <button>Resume</button>
              </form>
            ) : null}
            {!(["REVOKED", "EXPIRED"] as string[]).includes(mandate.status) ? (
              <form
                action={transitionMandateAction.bind(
                  null,
                  mandate.id,
                  "revoke",
                )}
              >
                <button className="danger-link">Revoke</button>
              </form>
            ) : null}
          </section>
          <details className="technical-details safety-test">
            <summary>Advanced safety test</summary>
            <h2>Test a forbidden action</h2>
            <p>
              Ask Relic to evaluate a token transfer. This observe-only mandate
              must deny it before wallet signing, job preparation, or execution.
            </p>
            <form
              action={requestForbiddenTransfer.bind(null, mandate.id)}
              className="execution-request-form"
            >
              <label>
                Public destination used in the policy request
                <input
                  name="destination"
                  required
                  pattern="0x[0-9a-fA-F]{40}"
                  placeholder="0x…"
                />
              </label>
              <button disabled={mandate.status !== "ACTIVE"}>
                Verify transfer is denied
              </button>
            </form>
            <small>No transaction is constructed or submitted.</small>
          </details>
        </aside>
      </section>
    </main>
  );
}
