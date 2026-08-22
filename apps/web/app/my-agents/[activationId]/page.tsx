import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatBaseUnits,
  type ExecutionRecord,
  type PolicyReason,
} from "@relic/domain";

import { agreements, type CommerceAgreementView } from "../../../lib/commerce";
import { getMandate, listExecutions } from "../../../lib/mandates";
import { relativeTime } from "../../../lib/marketplace";
import { requestHealthObservation } from "../../execution-actions";
import { transitionMandateAction } from "../../mandate-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Execution Room" };

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
  const noPosition = outcome.noPosition === true;
  const riskLevel =
    typeof outcome.riskLevel === "string" ? outcome.riskLevel : null;
  const observedProtocol =
    typeof outcome.protocol === "string"
      ? outcome.protocol
      : execution.action.protocol;

  let result = sentenceCase(execution.status);
  if (denied) result = "Request blocked before execution";
  else if (failed) result = "The requested check could not be completed";
  else if (succeeded && noPosition)
    result = "No active Venus lending position was found";
  else if (succeeded) result = "The requested check completed successfully";
  else if (execution.status === "APPROVAL_REQUIRED")
    result = "Waiting for explicit approval";

  let risk = sentenceCase(execution.status);
  if (denied) risk = "Protected by policy";
  else if (failed) risk = "Result unavailable";
  else if (noPosition) risk = "No active position";
  else if (riskLevel !== null) risk = sentenceCase(riskLevel);
  else if (succeeded) risk = "Check completed";

  let action = sentenceCase(execution.action.actionType);
  if (denied)
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
  if (denied) context = "Relic stopped this before the agent could act.";
  else if (failed) context = "No successful result was persisted.";
  else if (execution.receipt?.source === "independently_observed")
    context = "Relic independently observed this result.";
  else if (execution.receipt?.source === "onchain_verified")
    context = "Relic verified this result onchain.";
  else if (execution.receipt?.source === "provider_reported")
    context =
      "The provider reported this result; technical evidence shows its source.";

  return { action, context, funds, result, risk, why };
};

export default async function ExecutionRoomPage({
  params,
}: {
  params: Promise<{ activationId: string }>;
}) {
  const { activationId } = await params;
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
  let commerceAgreement: CommerceAgreementView | null = null;
  if (walletAuthenticated) {
    try {
      commerceAgreement =
        (await agreements()).find((item) => item?.mandateId === mandate.id) ??
        null;
    } catch {
      commerceAgreement = null;
    }
  }
  const latest = executions[0] ?? null;
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
  return (
    <main className="page-shell execution-room">
      <nav className="breadcrumbs">
        <Link href="/my-agents">My Agents</Link>
        <span>/</span>
        <span>Execution Room</span>
      </nav>
      <header className="execution-room-header">
        <div>
          <span className="overline">
            Controlled operations ·{" "}
            {walletAuthenticated
              ? "Wallet-authenticated principal"
              : "Development principal"}
          </span>
          <h1>Execution Room</h1>
          <p>{mandate.version.objective}</p>
        </div>
        <aside
          className={`execution-state ${mandate.attentionReason ? "attention" : ""}`}
        >
          <span>Relationship state</span>
          <strong>
            {mandate.attentionReason ? "NEEDS ATTENTION" : mandate.status}
          </strong>
          <small>BNB Chain Testnet · mandate v{mandate.currentVersion}</small>
        </aside>
      </header>

      {commerceAgreement === null ? null : (
        <section className="execution-commerce-context">
          <div>
            <span className="overline">Commercial context</span>
            <h2>Agreement {commerceAgreement.status.replaceAll("_", " ")}</h2>
            <p>
              Policy approval and wallet transaction authority remain separate.
              Every ERC-8183 write stays visible as a durable operation.
            </p>
          </div>
          <dl className="commerce-facts">
            <div>
              <dt>Expected price</dt>
              <dd>
                {formatBaseUnits(
                  commerceAgreement.pricingSnapshot.amountBaseUnits,
                  commerceAgreement.pricingSnapshot.decimals,
                )}{" "}
                {commerceAgreement.pricingSnapshot.symbol}
              </dd>
            </div>
            <div>
              <dt>Authorization</dt>
              <dd>
                {commerceAgreement.authorizationArtifactId === null
                  ? "Wallet authorization required"
                  : "Verified wallet signature"}
              </dd>
            </div>
            <div>
              <dt>Funded</dt>
              <dd>
                {formatBaseUnits(
                  movementTotal(["FUNDING", "ESCROW_LOCK"]),
                  commerceAgreement.pricingSnapshot.decimals,
                )}{" "}
                {commerceAgreement.pricingSnapshot.symbol}
              </dd>
            </div>
            <div>
              <dt>Settled</dt>
              <dd>
                {formatBaseUnits(
                  movementTotal(["PAYMENT", "ESCROW_RELEASE"]),
                  commerceAgreement.pricingSnapshot.decimals,
                )}{" "}
                {commerceAgreement.pricingSnapshot.symbol}
              </dd>
            </div>
            <div>
              <dt>Refunded</dt>
              <dd>
                {formatBaseUnits(
                  movementTotal(["REFUND"]),
                  commerceAgreement.pricingSnapshot.decimals,
                )}{" "}
                {commerceAgreement.pricingSnapshot.symbol}
              </dd>
            </div>
            <div>
              <dt>ERC-8183 operations</dt>
              <dd>
                {commerceAgreement.operations.length} durable ·{" "}
                {
                  commerceAgreement.operations.filter(
                    (operation) => operation.state === "AWAITING_SIGNATURE",
                  ).length
                }{" "}
                awaiting wallet
              </dd>
            </div>
          </dl>
          <Link href={`/commerce/agreements/${commerceAgreement.id}`}>
            Inspect agreement and technical evidence →
          </Link>
        </section>
      )}

      <section className="execution-console-grid">
        <div className="execution-feed">
          <span className="overline">Persisted activity</span>
          <h2>What the agent did—and why</h2>
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
                      <strong>{sentenceCase(execution.status)}</strong>
                      <span>{execution.decision ?? "PENDING"}</span>
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
            <span className="overline">Current authority</span>
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
                <dd>{latest?.status ?? "None"}</dd>
              </div>
            </dl>
          </section>
          <section>
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
            <Link href={`/mandates/${mandate.id}`}>
              Inspect or edit mandate
            </Link>
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
        </aside>
      </section>
    </main>
  );
}
