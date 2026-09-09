"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

import {
  prepareWalletAuthorization,
  preflightHealthGuard,
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
import type { HealthGuardPreflight } from "../../lib/mandates";
import { Check, CircleHelp, ShieldCheck } from "lucide-react";
import { AltanaSessionAuthorization } from "./altana-session-authorization";
import { KernelSessionAuthorization } from "./kernel-session-authorization";
import { kernelSmartAccountEnabled } from "../../lib/zerodev-smart-account";

type QuickServiceCheckoutProps = {
  agentId: string;
  agentName: string;
  agentCategory: string;
  agentCapabilities?: readonly string[];
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
  agentCapabilities = [],
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
  const [authorizationStep, setAuthorizationStep] = useState<"configure" | "review">(
    "configure",
  );
  const [authorizationInputs, setAuthorizationInputs] = useState<Record<string, string>>({});
  const [authorizationMandateId, setAuthorizationMandateId] = useState<string | null>(null);
  const [healthGuardPreflight, setHealthGuardPreflight] = useState<HealthGuardPreflight | null>(null);
  const requiresWalletAuthorization =
    agentCategory === "rebalancing" || agentCategory === "yield-optimisation" || agentCategory === "grid-trading" ||
    (agentCategory === "health-factor-monitoring" && agentCapabilities.includes("repay_debt"));
  const isRebalancing = agentCategory === "rebalancing";
  const isGridTrader = agentCategory === "grid-trading";
  const useKernelAuthorization = isGridTrader && kernelSmartAccountEnabled();
  const isHealthGuard = agentCategory === "health-factor-monitoring" && agentCapabilities.includes("repay_debt");
  const healthGuardPoolOptions = workflow.requirements.find((field) => field.name === "healthGuardPoolId")?.options ?? [];
  const healthGuardPool = healthGuardPoolOptions.find(
    (pool) => pool.value === authorizationInputs.healthGuardPoolId,
  );
  const checkoutUnavailable = isHealthGuard && healthGuardPoolOptions.length === 0;

  const start = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      const session = await fetch("/api/auth/session", { cache: "no-store" });
      if (session.ok) {
        if (requiresWalletAuthorization) setAuthorizationStep("configure");
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
    const schema = checkoutInputSchemaFor(agentCategory, isHealthGuard);
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
    if (requiresWalletAuthorization && authorizationStep === "configure") {
      if (isHealthGuard) {
        try {
          const preflight = await preflightHealthGuard(formData);
          if (!preflight.eligible) {
            setError(preflight.reason === "no_usdt_debt"
              ? "This wallet has no Venus Core Pool USDT debt to protect."
              : "This wallet has no eligible collateral position in the selected Venus pool.");
            return;
          }
          setHealthGuardPreflight(preflight);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Could not verify this Venus position.");
          return;
        }
      }
      setAuthorizationInputs(
        workflow.requirements.reduce<Record<string, string>>((inputs, field) => {
          inputs[field.name] = String(formData.get(field.name) ?? "");
          return inputs;
        }, {}),
      );
      setFieldErrors({});
      setError(null);
      setAuthorizationStep("review");
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      if (requiresWalletAuthorization) {
        const prepared = await prepareWalletAuthorization(formData);
        setAuthorizationMandateId(prepared.mandateId);
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
        if (!nextOpen && requiresWalletAuthorization) setAuthorizationStep("configure");
      }}
    >
      <Button
        className={className}
        type="button"
        onClick={start}
        disabled={checkoutUnavailable}
        title={checkoutUnavailable ? "This Health Guard has no verified pool configuration yet." : undefined}
      >
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
        ) : authorizationMandateId !== null ? (
          <>
            <DialogHeader>
              <span className="overline">Secure wallet authorization</span>
              <DialogTitle>Grant this service&apos;s exact permission</DialogTitle>
              <DialogDescription>
                This is a buyer-owned wallet grant. The order remains inactive until Relic verifies it on-chain.
              </DialogDescription>
            </DialogHeader>
            {useKernelAuthorization ? <KernelSessionAuthorization
              mandateId={authorizationMandateId}
              onAuthorized={async () => {
                const started = await startHireCheckoutForAuthorizedMandate({
                  mandateId: authorizationMandateId,
                  offerId,
                });
                setAuthorizationMandateId(null);
                setCheckout(started);
              }}
            /> : <AltanaSessionAuthorization
              mandateId={authorizationMandateId}
              onAuthorized={async () => {
                const started = await startHireCheckoutForAuthorizedMandate({
                  mandateId: authorizationMandateId,
                  offerId,
                });
                setAuthorizationMandateId(null);
                setCheckout(started);
              }}
            />}
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
          {requiresWalletAuthorization && authorizationStep === "review"
            ? workflow.requirements.map((field) => (
                <input
                  key={field.name}
                  type="hidden"
                  name={field.name}
                  value={authorizationInputs[field.name] ?? ""}
                />
              ))
            : null}
          {(!requiresWalletAuthorization || authorizationStep === "configure") ? (
            <TooltipProvider delayDuration={180}>
            {workflow.requirements.map((field) => field.options === undefined ? (
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
          ) : (
            <fieldset className="checkout-pool-field" key={field.name}>
              <legend className="checkout-field-label">{field.label}</legend>
              <small>{field.helper}</small>
              <div className="checkout-pool-options">
                {field.options.map((option, index) => (
                  <label className="checkout-pool-option" key={option.value}>
                    <input name={field.name} type="radio" value={option.value} required={field.required} defaultChecked={index === 0} />
                    <span>
                      <b>{option.title}</b>
                      {option.meta === undefined ? null : <em>{option.meta}</em>}
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
              {fieldErrors[field.name] === undefined ? null : <small className="form-error" role="alert">{fieldErrors[field.name]}</small>}
            </fieldset>
          ))}
          </TooltipProvider>
          ) : (
            <>
              <section className="secure-permission-review" aria-labelledby="secure-permission-title">
                <div className="secure-permission-heading">
                  <ShieldCheck aria-hidden="true" size={18} />
                  <div>
                    <span className="overline">Your secure wallet permission</span>
                    <h3 id="secure-permission-title">Exactly what this service can do</h3>
                  </div>
                </div>
                <p>{workflow.permissionSummary}</p>
                {isRebalancing ? (
                  <dl className="secure-permission-limits">
                    <div><dt>Position</dt><dd>#{authorizationInputs.positionTokenId}</dd></div>
                    <div><dt>Capital cap</dt><dd>{authorizationInputs.capitalCap} TEST_USDT</dd></div>
                    <div><dt>Range</dt><dd>±{Number(authorizationInputs.rangeWidthBps ?? "0") / 100}%</dd></div>
                    <div><dt>Ends after</dt><dd>{authorizationInputs.durationHours} hours</dd></div>
                  </dl>
                ) : isHealthGuard ? (
                  <dl className="secure-permission-limits">
                    <div><dt>Pool</dt><dd>{healthGuardPool?.title ?? "Selected verified pool"}</dd></div>
                    {healthGuardPool?.meta === undefined ? null : <div><dt>Scope</dt><dd>{healthGuardPool.meta}</dd></div>}
                    {healthGuardPreflight === null ? null : <>
                      <div><dt>Current health factor</dt><dd>{healthGuardPreflight.healthFactorWad === null ? "Unavailable" : (Number(BigInt(healthGuardPreflight.healthFactorWad)) / 1e18).toFixed(4)}</dd></div>
                      <div><dt>Collateral markets</dt><dd>{healthGuardPreflight.collateralMarkets.length}</dd></div>
                    </>}
                    <div><dt>Repay trigger</dt><dd>{authorizationInputs.threshold}</dd></div>
                    <div><dt>Target health factor</dt><dd>{authorizationInputs.target}</dd></div>
                    <div><dt>Per action</dt><dd>{authorizationInputs.maximumRepay} {healthGuardPool?.meta?.split(" · ").at(-1)?.replace(" debt", "") ?? "debt asset"}</dd></div>
                    <div><dt>Total cap</dt><dd>{authorizationInputs.aggregateRepayLimit} {healthGuardPool?.meta?.split(" · ").at(-1)?.replace(" debt", "") ?? "debt asset"}</dd></div>
                    {(isGridTrader || !isRebalancing) && <div><dt>Network fee cap</dt><dd>{authorizationInputs.maxFeeBnb} BNB</dd></div>}
                    <div><dt>Expires after</dt><dd>{authorizationInputs.durationHours} hours</dd></div>
                  </dl>
                ) : (
                  <dl className="secure-permission-limits">
                    <div><dt>Supply cap</dt><dd>{authorizationInputs.capitalCap} TEST_USDT</dd></div>
                    <div><dt>One test run</dt><dd>{authorizationInputs.executionAmount} TEST_USDT</dd></div>
                    <div><dt>Network fee cap</dt><dd>{authorizationInputs.maxFeeBnb} BNB</dd></div>
                    <div><dt>Expires after</dt><dd>{authorizationInputs.durationHours} hours</dd></div>
                  </dl>
                )}
                <ul>
                  <li><Check aria-hidden="true" size={14} /> {isGridTrader || isRebalancing ? "BNB/USDT only" : isHealthGuard ? `${healthGuardPool?.title ?? "Selected verified pool"} debt only` : "BSC Testnet USDT only"}</li>
                  <li><Check aria-hidden="true" size={14} /> {isGridTrader || isRebalancing ? "Configured PancakeSwap V3 contracts only" : "Configured Venus contracts only"}</li>
                  <li><Check aria-hidden="true" size={14} /> {isGridTrader ? "Only within the price range and capital cap you set" : isRebalancing ? "At most one rebalance per hour" : isHealthGuard ? "A repayment only after a fresh health check" : "Exactly one supply-and-withdraw test run"}</li>
                  <li><Check aria-hidden="true" size={14} /> Revoke any time</li>
                </ul>
                <details>
                  <summary>How secure authorization works</summary>
                  <p>
                    Before this service can act, you authorize a separate, buyer-owned
                    Altana session in your wallet. Relic never receives your wallet private
                    key. The session is encrypted at rest, expires automatically, and can
                    call only the contracts and spend cap shown above.
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
          {requiresWalletAuthorization && authorizationStep === "configure" ? null : (
            <label className="terms-confirm">
              <input type="checkbox" name="explicitApproval" value="approved" required />
              {requiresWalletAuthorization
                ? "I understand that a separate wallet authorization is required before this service can execute."
                : "I approve the displayed permissions and service terms."}
            </label>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() =>
                requiresWalletAuthorization && authorizationStep === "review"
                  ? setAuthorizationStep("configure")
                  : setOpen(false)
              }
            >
              {requiresWalletAuthorization && authorizationStep === "review" ? "Back" : "Cancel"}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? "Preparing secure request…"
                : requiresWalletAuthorization && authorizationStep === "configure"
                  ? "Review secure permission"
                  : "Confirm & sign"}
            </Button>
          </DialogFooter>
          {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
          <small className="quick-checkout-note">
            {requiresWalletAuthorization && authorizationStep === "configure"
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
