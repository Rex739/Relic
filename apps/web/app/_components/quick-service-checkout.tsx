"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

import { startHireCheckout } from "../mandate-actions";
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
import type { ServiceWorkflow } from "../../lib/service-workflow";

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

  const start = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      const session = await fetch("/api/auth/session", { cache: "no-store" });
      if (session.ok) {
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
    setSubmitting(true);
    setError(null);
    try {
      const started = await startHireCheckout(new FormData(event.currentTarget));
      setCheckout(started);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start this service.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button className={className} type="button" onClick={start}>
        {label}
      </button>
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
        ) : (
          <>
        <DialogHeader>
          <span className="overline">Create task</span>
          <DialogTitle>{workflow.taskLabel}</DialogTitle>
          <DialogDescription>{workflow.taskDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="quick-checkout-form">
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="offerId" value={offerId} />
          <input type="hidden" name="chainId" value={chainId} />
          <input type="hidden" name="category" value={agentCategory} />
          <input type="hidden" name="objective" value={`Run ${workflow.taskLabel} for my requested inputs.`} />
          {workflow.requirements.map((field) => (
            <label key={field.name}>
              {field.label}
              <input
                name={field.name}
                type={field.type ?? "text"}
                {...(field.name === "publicAccount" && field.required
                  ? { pattern: "0x[0-9a-fA-F]{40}" }
                  : {})}
                {...(field.required ? { required: true } : {})}
                defaultValue={
                  field.name === "threshold"
                    ? "1.30"
                    : field.name === "durationDays"
                      ? "14"
                      : undefined
                }
                placeholder={field.placeholder}
              />
              <small>{field.helper}</small>
            </label>
          ))}
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
          <label className="terms-confirm">
            <input type="checkbox" name="explicitApproval" value="approved" required />
            I approve the displayed permissions and service terms.
          </label>
          <DialogFooter>
            <button className="secondary-button" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? "Preparing secure request…" : "Confirm & sign"}
            </button>
          </DialogFooter>
          {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
          <small className="quick-checkout-note">You&apos;ll sign in this dialog. Relic will show any payment before funds move.</small>
        </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
