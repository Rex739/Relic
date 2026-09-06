import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  marketplaceReviewTags,
  type ExecutionRecord,
  type PolicyReason,
} from "@relic/domain";

import { agreements, type CommerceAgreementView } from "../../../lib/commerce";
import { commercePriceLabel, isFreePrice } from "../../../lib/commerce-display";
import { getMandate, listExecutions } from "../../../lib/mandates";
import { marketplaceAgent, relativeTime } from "../../../lib/marketplace";
import {
  relationshipSetupComplete,
  relationshipStatus,
  selectRelationshipAgreement,
} from "../../../lib/relationship-status";
import { requestHealthObservation, requestLpRebalance } from "../../execution-actions";
import { transitionMandateAction } from "../../mandate-actions";
import {
  prepareCommerceActivationAction,
} from "../../commerce-actions";
import { CommerceAuthorization } from "../../_components/commerce-authorization";
import { CommerceStatusRefresh } from "../../_components/commerce-status-refresh";
import { InitialHealthObservation } from "../../_components/initial-health-observation";
import { WalletCommerceOperation } from "../../_components/wallet-commerce-operation";
import { MarketplaceReviewPrompt } from "../../_components/marketplace-review-prompt";
import { serviceWorkflowFor } from "../../../lib/service-workflow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order" };
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
  const withdrawalTransactionHash =
    typeof outcome.withdrawalTransactionHash === "string"
      ? outcome.withdrawalTransactionHash
      : null;
  const mintTransactionHash =
    typeof outcome.mintTransactionHash === "string"
      ? outcome.mintTransactionHash
      : null;
  const swapTransactionHash =
    typeof outcome.swapTransactionHash === "string"
      ? outcome.swapTransactionHash
      : null;
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
  else if (succeeded && mintTransactionHash !== null)
    result = "PancakeSwap V3 position rebalanced on-chain";
  else if (succeeded) result = "The requested check completed successfully";
  else if (execution.status === "APPROVAL_REQUIRED")
    result = "Waiting for explicit approval";

  let risk = sentenceCase(execution.status);
  if (denied && safetyValidation) risk = "Protection confirmed";
  else if (denied) risk = "Protected by policy";
  else if (failed) risk = "Result unavailable";
  else if (noPosition) risk = "No active position";
  else if (riskLevel === "critical") risk = "Critical — shortfall detected";
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
  else if (succeeded && riskLevel === "critical")
    context =
      "Venus reports a shortfall at the observed block. This position may be eligible for liquidation.";
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
    mintTransactionHash,
    result,
    risk,
    withdrawalTransactionHash,
    swapTransactionHash,
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

const requestedValues = (
  category: string,
  constraints: Record<string, unknown>,
  objective: string,
) => {
  const workflow = serviceWorkflowFor(category);
  const values: Record<string, unknown> = {
    publicAccount: constraints.monitoredAccount,
    threshold: constraints.alertHealthFactorBelow,
    asset: constraints.requestedAsset,
    target: constraints.target,
    objective,
  };
  return workflow.requirements
    .map((field) => ({ label: field.label, value: values[field.name] }))
    .filter(
      (item): item is { label: string; value: string | number } =>
        typeof item.value === "string" || typeof item.value === "number",
    );
};

export default async function ExecutionRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ activationId: string }>;
  searchParams: Promise<{
    exactAuthorizationId?: string;
    start?: string;
    checkoutError?: string;
  }>;
}) {
  const { activationId } = await params;
  const {
    exactAuthorizationId: requestedRecoveryAuthorizationId,
    checkoutError,
  } = await searchParams;
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
  const isLpRangeRebalancer = agentResponse.data?.category === "rebalancing";
  const workflow = serviceWorkflowFor(agentResponse.data?.category ?? "");
  const request = requestedValues(
    agentResponse.data?.category ?? "",
    mandate.version.riskConstraints,
    mandate.version.objective,
  );
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
  const isAwaitingCheckoutAction = (
    operation: NonNullable<typeof commerceAgreement>["operations"][number],
  ) =>
    (operation.state === "AWAITING_SIGNATURE" ||
      operation.state === "SUBMITTED" ||
      operation.state === "PENDING" ||
      operation.state === "CONFIRMED") &&
    typeof operation.executionRequestId === "string" &&
    (operation.operationType === "CREATE_JOB" ||
      operation.operationType === "REGISTER_JOB" ||
      operation.operationType === "SET_BUDGET" ||
      operation.operationType === "FUND");
  const awaitingOperations = commerceAgreement?.operations.toReversed();
  // An offer-bound preparation supersedes any retired legacy checkout action.
  const awaitingActionOperation =
    awaitingOperations?.find((operation) => {
      const evidence = operation.evidence as Record<string, unknown>;
      return (
        isAwaitingCheckoutAction(operation) &&
        evidence.commerceValidation === true &&
        evidence.quote !== null &&
        typeof evidence.quote === "object"
      );
    }) ??
    awaitingOperations?.find(
      (operation) =>
        isAwaitingCheckoutAction(operation),
    );
  const commerceExecution = executions.find(
    (execution) => execution.id === awaitingActionOperation?.executionRequestId,
  );
  const awaitingOperationEvidence = awaitingActionOperation?.evidence as
    Record<string, unknown> | undefined;
  const awaitingOperationType = awaitingActionOperation?.operationType;
  const unsignedLegacyCheckout =
    commerceAgreement?.status === "ACTIVE" &&
    commerceAgreement.operations.some(
      (operation) =>
        (operation.evidence as Record<string, unknown>).commerceValidation !==
          true &&
        operation.transactionHash === null &&
        ["CREATED", "AWAITING_SIGNATURE"].includes(String(operation.state)),
    );
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
  const setupComplete = relationshipSetupComplete(commerceAgreement);
  // A pre-payment policy observation is used to validate the request and bind
  // checkout authorization. It is not a paid service delivery.
  const visibleServiceUpdates = setupComplete ? executions : [];
  const relationshipState = relationshipStatus({
    mandate,
    agreement: commerceAgreement,
    hasUpdate: latest !== null,
  });
  const checkoutAwaitingFinality =
    commerceAgreement?.operations.some((operation) =>
      ["SUBMITTED", "PENDING", "CONFIRMED", "REORGED"].includes(
        String(operation.state),
      ),
    ) ?? false;
  const reviewableActivationId = commerceAgreement?.operations
    .toReversed()
    .find(
      (operation) =>
        typeof operation.activationId === "string" &&
        operation.state === "FINALIZED",
    )?.activationId;
  return (
    <main className="page-shell execution-room">
      <CommerceStatusRefresh active={checkoutAwaitingFinality} />
      <nav className="breadcrumbs">
        <Link href="/account/my-hires">My orders</Link>
        <span>/</span>
        <span>Order</span>
      </nav>
      <header className="execution-room-header">
        <div>
          <span className="overline">Order · {relationshipState}</span>
          <h1>{workflow.taskLabel}</h1>
          <p>Provided by {agentName}</p>
        </div>
        <aside
          className={`execution-state ${mandate.attentionReason ? "attention" : ""}`}
        >
            <span>Order status</span>
          <strong>{relationshipState.toUpperCase()}</strong>
          <small>
            BNB Chain Testnet ·{" "}
            {mandate.version.approvalMode.replaceAll("_", " ")}
          </small>
        </aside>
      </header>

      <section className="running-overview order-overview" aria-label="Order overview">
          <div>
            <span className="overline">Your order</span>
            <h2>{relationshipState === "Running" ? "Your service is running" : relationshipState}</h2>
            <p>{workflow.taskDescription}</p>
          </div>
          <dl>
            <div>
              <dt>Service price</dt>
              <dd>{commerceAgreement === null ? "Unavailable" : isFreePrice(commerceAgreement.pricingSnapshot) ? "Free service" : commercePriceLabel(commerceAgreement.pricingSnapshot)}</dd>
            </div>
            <div>
              <dt>Payment status</dt>
              <dd>{setupComplete ? "Paid" : "Not charged yet"}</dd>
            </div>
          </dl>
        </section>

      <details className="order-contract order-contract-detail">
        <summary>View request and deliverables</summary>
        <div className="order-contract-body">
          <section>
            <span>Requested</span>
            {request.length === 0 ? <p>{mandate.version.objective}</p> : (
              <dl>{request.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
            )}
          </section>
          <section>
            <span>You&apos;ll receive</span>
            <ul>{workflow.deliverables.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        </div>
      </details>

      {relationshipState === "Completed" &&
      walletAuthenticated &&
      typeof reviewableActivationId === "string" ? (
        <MarketplaceReviewPrompt
          activationId={reviewableActivationId}
          tagOptions={marketplaceReviewTags.BUYER}
        />
      ) : null}

      {setupComplete &&
      latest === null &&
      agentResponse.data?.category === "health-factor-monitoring" ? (
        <InitialHealthObservation mandateId={mandate.id} />
      ) : null}

      {commerceAgreement === null || setupComplete ? null : (
        <section className="execution-commerce-context">
          <div>
            <span className="overline">Order progress</span>
            <h2>
              {commerceAgreement.status === "ACTIVE"
                ? "Ready to run"
                : sentenceCase(commerceAgreement.status)}
            </h2>
            <p>
              {checkoutError !== undefined
                ? checkoutError
                : relationshipState === "Awaiting first update"
                ? "Your provider is preparing the first update. No action is needed from you."
                : relationshipState === "Completing payment"
                  ? "Your next checkout confirmation will appear here when it is required."
                  : "Relic will show a secure confirmation here only when your action is required."}
            </p>
          </div>
          {commerceExecution?.status === "SUCCEEDED" &&
          awaitingOperationType === "CREATE_JOB" ? (
            <div className="authorization-action">
              <strong>Confirm service request</strong>
              <p>
                Relic has checked your request. Confirm it in your wallet to
                continue; no funds move at this point.
              </p>
              {latestExactAuthorizationId === undefined ? (
                <CommerceAuthorization
                  agreementId={commerceAgreement.id}
                  continuationHref={`/account/my-hires/mandates/${mandate.id}`}
                  actionHash={`0x${commerceExecution.action.normalizedHash.replace(/^0x/, "")}`}
                />
              ) : (
                <p>Your request is confirmed. Preparing the wallet confirmation…</p>
              )}
            </div>
      ) : null}

          {unsignedLegacyCheckout ? (
            <div className="authorization-action">
              <strong>Update secure checkout</strong>
              <p>
                This unsigned setup was created by an earlier checkout flow.
                Restart it to use the current offer-bound payment sequence.
              </p>
              <form method="post" action={`/account/my-hires/mandates/${mandate.id}/restart`}>
                <button type="submit">Restart secure checkout</button>
              </form>
            </div>
          ) : null}
          {awaitingActionOperation !== undefined &&
          (awaitingOperationType === "REGISTER_JOB" ||
            awaitingOperationType === "SET_BUDGET" ||
            awaitingOperationType === "FUND" ||
            (awaitingOperationType === "CREATE_JOB" &&
              latestExactAuthorizationId !== undefined)) ? (
            <div className="authorization-action">
              <strong>Confirm in wallet</strong>
              <p>
                Your wallet will show the exact service and payment details
                before anything moves.
              </p>
              <WalletCommerceOperation
                agreementId={commerceAgreement.id}
                operationId={String(awaitingActionOperation.id)}
                operationType={awaitingOperationType}
                operationState={
                  awaitingActionOperation.state as
                    "AWAITING_SIGNATURE" | "SUBMITTED" | "PENDING" | "CONFIRMED"
                }
              />
            </div>
          ) : null}
          {commerceAgreement.status === "AUTHORIZATION_REQUIRED" &&
          latest?.status === "SUCCEEDED" ? (
            <div className="authorization-action">
              <strong>Confirm service request</strong>
              <p>
                Your request has been checked. Approve this exact read-only
                action to continue to the service payment confirmation.
              </p>
              <CommerceAuthorization
                agreementId={commerceAgreement.id}
                continuationHref={`/account/my-hires/mandates/${mandate.id}`}
                actionHash={`0x${latest.action.normalizedHash.replace(/^0x/, "")}`}
              />
            </div>
          ) : null}
          {commerceAgreement.status === "AUTHORIZED" &&
          commerceAgreement.authorizationArtifactId !== null &&
          commerceAgreement.operations.every(
            (operation) => operation.state === "CANCELLED",
          ) &&
          latest?.status === "SUCCEEDED" ? (
            recoveryAuthorizationId === undefined ? (
              <CommerceAuthorization
                agreementId={commerceAgreement.id}
                continuationHref={`/account/my-hires/mandates/${mandate.id}`}
                actionHash={`0x${latest.action.normalizedHash.replace(/^0x/, "")}`}
              />
            ) : (
              <form method="post" action={`/account/my-hires/mandates/${mandate.id}/restart`}>
                <button type="submit">
                  Continue checkout <span>→</span>
                </button>
              </form>
            )
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
                        defaultValue={recoveryObservedAccount}
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
                  continuationHref={`/account/my-hires/mandates/${mandate.id}`}
                  actionHash={`0x${latest.action.normalizedHash.replace(/^0x/, "")}`}
                />
              ) : (
                <form action={prepareCommerceActivationAction}>
                  <input
                    type="hidden"
                    name="agreementId"
                    defaultValue={commerceAgreement.id}
                  />
                  <input
                    type="hidden"
                    name="executionRequestId"
                    defaultValue={latest.id}
                  />
                  <input
                    type="hidden"
                    name="authorizationId"
                    defaultValue={recoveryAuthorizationId}
                  />
                  <input
                    type="hidden"
                    name="mandateId"
                    defaultValue={mandate.id}
                  />
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
          <span className="overline">Service updates</span>
          <h2>Updates</h2>
          {visibleServiceUpdates.length === 0 ? (
            <div className="empty-relationships">
              <h3>{setupComplete ? "No update yet." : "Your service has not started yet."}</h3>
              <p>
                {setupComplete
                  ? "Your agent's first update will appear here when it is available."
                  : "Complete checkout to start the service. The request validation above does not count as a paid delivery."}
              </p>
            </div>
          ) : (
            visibleServiceUpdates.slice(0, 1).map((execution) => {
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
                      <dl className="execution-result-facts">
                        <div>
                          <dt>Risk</dt>
                          <dd>{presentation.risk}</dd>
                        </div>
                        {presentation.withdrawalTransactionHash === null ? null : (
                          <div>
                            <dt>Withdrawal</dt>
                            <dd>
                              <a
                                href={`https://testnet.bscscan.com/tx/${presentation.withdrawalTransactionHash}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View transaction ↗
                              </a>
                            </dd>
                          </div>
                        )}
                        {presentation.mintTransactionHash === null ? null : (
                          <div>
                            <dt>Replacement position</dt>
                            <dd>
                              <a
                                href={`https://testnet.bscscan.com/tx/${presentation.mintTransactionHash}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View transaction ↗
                              </a>
                            </dd>
                          </div>
                        )}
                        {presentation.swapTransactionHash === null ? null : (
                          <div>
                            <dt>Balancing swap</dt>
                            <dd>
                              <a
                                href={`https://testnet.bscscan.com/tx/${presentation.swapTransactionHash}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View transaction ↗
                              </a>
                            </dd>
                          </div>
                        )}
                      </dl>
                    </section>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <aside className="execution-sidebar">
          <details className="order-settings">
            <summary>Manage order</summary>
            <p>{workflow.permissionSummary}</p>
            <div className="execution-controls">
            {isLpRangeRebalancer && mandate.status === "ACTIVE" && setupComplete ? (
              <form action={requestLpRebalance.bind(null, mandate.id)}>
                <button type="submit">Check range &amp; rebalance now <span>→</span></button>
                <small>
                  Relic checks the live PancakeSwap V3 position first. If it is
                  out of range and within the mandate, it submits the approved
                  on-chain rebalance and records both transaction hashes here.
                </small>
              </form>
            ) : null}
            {mandate.status === "ACTIVE" ? (
              <form
                action={transitionMandateAction.bind(null, mandate.id, "pause")}
              >
                <button>Pause task</button>
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
                <button>Resume task</button>
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
                <button className="danger-link">Cancel task</button>
              </form>
            ) : null}
            </div>
          </details>
        </aside>
      </section>
    </main>
  );
}
