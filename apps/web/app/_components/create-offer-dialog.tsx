"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { labelForCategory } from "../../lib/marketplace";
import { formatDisplayBaseUnits } from "../../lib/commerce-display";

type PricedSellerAgent = {
  agentId: string;
  serviceId: string;
  name: string;
  chainId: number;
  category: string;
  verifiedPrice: {
    amountBaseUnits: string;
    decimals: number;
    tokenAddress: string;
    symbol: string;
  };
};

export function CreateOfferDialog({
  agent,
  action,
}: {
  agent: PricedSellerAgent;
  action: (formData: FormData) => Promise<{ error: string | null }>;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setError(null);
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" size={18} />
          Create marketplace offer
        </Button>
      </DialogTrigger>
      <DialogContent className="offer-dialog-content">
        <DialogHeader>
          <span className="overline">Marketplace offer</span>
          <DialogTitle>Create an offer for {agent.name}</DialogTitle>
          <DialogDescription>
            Relic has filled in the verified service, category, and price. Add
            the buyer-facing deliverable and any limitations.
          </DialogDescription>
        </DialogHeader>
        <form
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              const result = await action(formData);
              if (result.error !== null) {
                setError(result.error);
                return;
              }
              setOpen(false);
            })
          }
          className="commerce-form"
        >
          <input type="hidden" name="agentId" value={agent.agentId} />
          <input type="hidden" name="serviceId" value={agent.serviceId} />
          <input type="hidden" name="chainId" value={agent.chainId} />
          <input
            type="hidden"
            name="capability"
            value={labelForCategory(agent.category)}
          />
          <input type="hidden" name="billingModel" value="PER_EXECUTION" />
          <input
            type="hidden"
            name="price"
            value={formatDisplayBaseUnits(
              agent.verifiedPrice.amountBaseUnits,
              agent.verifiedPrice.decimals,
            )}
          />
          <input
            type="hidden"
            name="decimals"
            value={agent.verifiedPrice.decimals}
          />
          <input
            type="hidden"
            name="tokenAddress"
            value={agent.verifiedPrice.tokenAddress}
          />
          <input
            type="hidden"
            name="symbol"
            value={agent.verifiedPrice.symbol}
          />
          <input type="hidden" name="capabilities" value={agent.category} />

          <dl className="offer-dialog-summary">
            <div>
              <dt>Network</dt>
              <dd>
                {agent.chainId === 56 ? "BNB Chain" : "BNB Chain Testnet"}
              </dd>
            </div>
            <div>
              <dt>Capability</dt>
              <dd>{labelForCategory(agent.category)}</dd>
            </div>
            <div>
              <dt>Verified price</dt>
              <dd>
                {formatDisplayBaseUnits(
                  agent.verifiedPrice.amountBaseUnits,
                  agent.verifiedPrice.decimals,
                )}{" "}
                {agent.verifiedPrice.symbol} per execution
              </dd>
            </div>
          </dl>

          <label>
            What should buyers know this agent cannot do?
            <textarea
              name="limitations"
              placeholder={
                "One limitation per line\nExample: Does not move funds"
              }
            />
          </label>
          <label>
            What will the buyer receive?
            <textarea
              name="terms"
              placeholder="Describe the result, scope, and delivery the buyer can expect. These terms become immutable when this draft is created."
              required
            />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save offer draft"}
            </Button>
            <small>
              Saving a draft does not publish the offer or send a transaction.
            </small>
          </DialogFooter>
          {error !== null ? (
            <p className="offer-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
