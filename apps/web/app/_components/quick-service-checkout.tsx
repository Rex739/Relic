"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

import {
  prepareRebalancingAuthorization,
  startHireCheckout,
  startHireCheckoutForAuthorizedMandate,
} from "../mandate-actions";
import { CommerceAuthorization } from "./commerce-authorization";
import { completeHireCheckoutActivation } from "../commerce-actions";
import { WalletCommerceOperation } from "./wallet-commerce-operation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import { checkoutInputSchemaFor } from "../../lib/checkout-input-validation";
import type { ServiceWorkflow } from "../../lib/service-workflow";
import { Check, CircleHelp, ShieldCheck } from "lucide-react";
import { AltanaSessionAuthorization } from "./altana-session-authorization";

type QuickServiceCheckoutProps = {
  agentId: string;
  agentName: string;
  agentCategory: string;
  offerId: string;
  chainId: number;
  price: string;
  network: string;
  workflow: ServiceWorkflow;
  className?: string;
  label?: string;
};

export function QuickServiceCheckout({
  agentId,
  agentName,
  agentCategory,
  offerId,
  chainId,
  price,
  network,
  workflow,
  className,
  label = "Try service",
}: QuickServiceCheckoutProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checkout, setCheckout] = useState<{
    mandateId: string;
    agreementId: string;
    operation?: {
      operationId: string;
      operationType:
        | "APPROVE_TOKEN"
        | "CREATE_JOB"
        | "REGISTER_JOB"
        | "SET_BUDGET"
        | "FUND";
      operationState: "AWAITING_SIGNATURE";
    };
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [rebalancingStep, setRebalancingStep] = useState<"configure" | "review">(
    "configure",
  );
  const [rebalancingInputs, setRebalancingInputs] = useState<Record<string, string>>({});
  const [rebalancingMandateId, setRebalancingMandateId] = useState<string | null>(null);
  const isRebalancing = agentCategory === "rebalancing";

  const start = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      const session = await fetch("/api/auth/session", { cache: "no-store" });
      if (session.ok) {
        if (isRebalancing) setRebalancingStep("configure");
        setOpen(true);
        return;
      }
    } catch {
      // The connect dialog remains the safe fallback when a session check fails.
    }
    window.dispatchEvent(
      new CustomEvent("relic:open-connect", {
        detail: { returnTo: `/agents/${agentId}` },
      }),
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const schema = checkoutInputSchemaFor(agentCategory);
    if (schema !== null) {
      const validation = schema.safeParse(Object.fromEntries(formData));
      if (!validation.success) {
        const errors = validation.error.issues.reduce<Record<string, string>>(
          (result, issue) => {
            const field = issue.path[0];
            if (typeof field === "string" && result[field] === undefined)
              result[field] = issue.message;
            return result;
          },
          {},
        );
        setFieldErrors(errors);
        setError("Review the highlighted inputs.");
        return;
      }
    }
    if (isRebalancing && rebalancingStep === "configure") {
      setRebalancingInputs(
        workflow.requirements.reduce<Record<string, string>>((inputs, field) => {
          inputs[field.name] = String(formData.get(field.name) ?? "");
          return inputs;
        }, {}),
      );
      setFieldErrors({});
      setError(null);
      setRebalancingStep("review");
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      if (isRebalancing) {
        const prepared = await prepareRebalancingAuthorization(formData);
        setRebalancingMandateId(prepared.mandateId);
        return;
      }
      const started = await startHireCheckout(formData);
      setCheckout(started);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start this service.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && isRebalancing) setRebalancingStep("configure");
      }}
    >
      <Button className={className} type="button" onClick={start}>
        {label}
      </Button>
      <DialogContent className="quick-checkout-dialog">
        {checkout !== null ? (
          <>
            <DialogHeader>
              <span className="overline">
                {checkout.operation === undefined
                  ? "Authorize service"
                  : "Complete checkout"}
              </span>
              <DialogTitle>
                {checkout.operation === undefined
                  ? "Confirm your service request"
                  : "Preparing your service"}
              </DialogTitle>
              <DialogDescription>
                {checkout.operation === undefined
                  ? "This free wallet signature securely authorizes the displayed service request. It does not move funds."
                  : "Relic will request each required wallet confirmation in sequence. Only the payment step moves your service price into escrow."}
              </DialogDescription>
            </DialogHeader>
            {checkout.operation === undefined ? (
              <CommerceAuthorization
                agreementId={checkout.agreementId}
                continuationHref={`/account/my-hires/mandates/${checkout.mandateId}?start=1`}
                autoStart
                onAuthorized={async () => {
                        const operation = await completeHireCheckoutActivation({
                          agreementId: checkout.agreementId,
                          mandateId: checkout.mandateId,
                        });
                        setCheckout((current) =>
                          current === null ? null : { ...current, operation },
                        );
                      }}
              />
            ) : (
              <WalletCommerceOperation
                agreementId={checkout.agreementId}
                operationId={checkout.operation.operationId}
                operationType={checkout.operation.operationType}
                operationState={checkout.operation.operationState}
                autoStart
                onNextOperation={(operation) =>
                  setCheckout((current) =>
                    current === null ? null : { ...current, operation },
                  )
                }
                onComplete={() => {
                  const destination = `/account/my-hires/mandates/${checkout.mandateId}`;
                  setCheckout(null);
                  setOpen(false);
                  router.replace(destination);
                  router.refresh();
                }}
              />
            )}
          </>
        ) : rebalancingMandateId !== null ? (
          <>
            <DialogHeader>
              <span className="overline">Secure wallet authorization</span>
              <DialogTitle>Grant the rebalancer&apos;s exact permission</DialogTitle>
              <DialogDescription>
                This is a buyer-owned wallet grant. The order remains inactive until Relic verifies it on-chain.
              </DialogDescription>
            </DialogHeader>
            <AltanaSessionAuthorization
              mandateId={rebalancingMandateId}
              onAuthorized={async () => {
                const started = await startHireCheckoutForAuthorizedMandate({
                  mandateId: rebalancingMandateId,
                  offerId,
                });
                setRebalancingMandateId(null);
                setCheckout(started);
              }}
            />
          </>
        ) : (
          <>
        <DialogHeader>
          <span className="overline">Create task</span>
          <DialogTitle>{workflow.taskLabel}</DialogTitle>
          <DialogDescription>{workflow.taskDescription}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="quick-checkout-form">
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="offerId" value={offerId} />
          <input type="hidden" name="chainId" value={chainId} />
          <input type="hidden" name="category" value={agentCategory} />
          <input type="hidden" name="objective" value={`Run ${workflow.taskLabel} for my requested inputs.`} />
          {isRebalancing && rebalancingStep === "review"
            ? workflow.requirements.map((field) => (
                <input
                  key={field.name}
                  type="hidden"
                  name={field.name}
                  value={rebalancingInputs[field.name] ?? ""}
                />
              ))
            : null}
          {(!isRebalancing || rebalancingStep === "configure") ? (
            <TooltipProvider delayDuration={180}>
            {workflow.requirements.map((field) => (
            <label key={field.name}>
              <span className="checkout-field-label">
                {field.label}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={`Explain ${field.label}`}
                      className="field-help-trigger"
                      type="button"
                    >
                      <CircleHelp aria-hidden="true" size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{field.help ?? field.helper}</TooltipContent>
                </Tooltip>
              </span>
              <Input
                name={field.name}
                type={field.type ?? "text"}
                {...(field.name === "publicAccount" && field.required
                  ? { pattern: "0x[0-9a-fA-F]{40}" }
                  : {})}
                {...(field.required ? { required: true } : {})}
                {...(field.type === "number"
                  ? {
                      inputMode: field.step === 1 ? "numeric" : "decimal",
                      min: field.min,
                      max: field.max,
                      step: field.step,
                    }
                  : {})}
                aria-describedby={`${field.name}-help${fieldErrors[field.name] === undefined ? "" : ` ${field.name}-error`}`}
                aria-invalid={fieldErrors[field.name] === undefined ? undefined : true}
                defaultValue={
                  field.name === "threshold"
                    ? "1.30"
                    : field.name === "durationDays"
                      ? "14"
                      : undefined
                }
                placeholder={field.placeholder}
              />
              <small id={`${field.name}-help`}>{field.helper}</small>
              {fieldErrors[field.name] === undefined ? null : (
                <small className="form-error" id={`${field.name}-error`} role="alert">
                  {fieldErrors[field.name]}
                </small>
              )}
            </label>
          ))}
          </TooltipProvider>
          ) : (
            <>
              <section className="secure-permission-review" aria-labelledby="secure-permission-title">
                <div className="secure-permission-heading">
                  <ShieldCheck aria-hidden="true" size={18} />
                  <div>
                    <span className="overline">Your secure trading permission</span>
                    <h3 id="secure-permission-title">Exactly what the rebalancer can do</h3>
                  </div>
                </div>
                <p>{workflow.permissionSummary}</p>
                <dl className="secure-permission-limits">
                  <div>
                    <dt>Position</dt>
                    <dd>#{rebalancingInputs.positionTokenId}</dd>
                  </div>
                  <div>
                    <dt>Capital cap</dt>
                    <dd>{rebalancingInputs.capitalCap} TEST_USDT</dd>
                  </div>
                  <div>
                    <dt>Range</dt>
                    <dd>±{Number(rebalancingInputs.rangeWidthBps ?? "0") / 100}%</dd>
                  </div>
                  <div>
                    <dt>Ends after</dt>
                    <dd>{rebalancingInputs.durationHours} hours</dd>
                  </div>
                </dl>
                <ul>
                  <li><Check aria-hidden="true" size={14} /> BNB/USDT only</li>
                  <li><Check aria-hidden="true" size={14} /> PancakeSwap V3 contracts only</li>
                  <li><Check aria-hidden="true" size={14} /> At most one rebalance per hour</li>
                  <li><Check aria-hidden="true" size={14} /> Revoke any time</li>
                </ul>
                <details>
                  <summary>How secure authorization works</summary>
                  <p>
                    Before the rebalancer can act, you authorize a separate, buyer-owned
                    Altana trading permission in your wallet. Relic never asks for your
                    private key. If this position is in a different wallet, you will move
                    only that LP NFT into your secure trading wallet first.
                  </p>
                </details>
              </section>
            </>
          )}
          <div className="quick-checkout-summary">
            <div>
              <span>Service</span>
              <b>{agentName}</b>
            </div>
            <div>
              <span>Price</span>
              <b>{price}</b>
            </div>
            <div>
              <span>Network</span>
              <b>{network}</b>
            </div>
          </div>
          <div className="quick-checkout-deliverables">
            <span>You&apos;ll receive</span>
            <ul>{workflow.deliverables.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          {isRebalancing && rebalancingStep === "configure" ? null : (
            <label className="terms-confirm">
              <input type="checkbox" name="explicitApproval" value="approved" required />
              {isRebalancing
                ? "I understand that a separate wallet authorization is required before the rebalancer can trade."
                : "I approve the displayed permissions and service terms."}
            </label>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() =>
                isRebalancing && rebalancingStep === "review"
                  ? setRebalancingStep("configure")
                  : setOpen(false)
              }
            >
              {isRebalancing && rebalancingStep === "review" ? "Back" : "Cancel"}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? "Preparing secure request…"
                : isRebalancing && rebalancingStep === "configure"
                  ? "Review secure permission"
                  : "Confirm & sign"}
            </Button>
          </DialogFooter>
          {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
          <small className="quick-checkout-note">
            {isRebalancing && rebalancingStep === "configure"
              ? "Next, you will review the exact position, cap, expiry, and contract scope."
              : "You&apos;ll sign in this dialog. Relic will show any payment before funds move."}
          </small>
        </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
