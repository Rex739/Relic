"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import {
  intentSearchParams,
  understandMarketplaceIntent,
} from "../../lib/marketplace";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

const marketplaceIntentInputSchema = z.string().trim().min(2).max(200);

export function IntentSearch({ initialValue = "" }: { initialValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const understood =
    value.trim().length > 3 ? understandMarketplaceIntent(value) : {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = marketplaceIntentInputSchema.safeParse(value);
    if (!parsed.success) {
      setError("Enter at least two characters to search.");
      return;
    }
    setError(null);
    router.push(`/marketplace?${intentSearchParams(parsed.data).toString()}`);
  };
  const label = (key: string, item: unknown) => {
    if (key === "capital" && typeof item === "object" && item !== null) {
      const value = item as { amount?: number; asset?: string };
      return `${value.amount?.toLocaleString() ?? ""} ${value.asset ?? ""}`.trim();
    }
    if (key === "durationDays" && typeof item === "number")
      return `${item} days`;
    return String(item);
  };
  const fieldLabel = (key: string) => {
    if (key === "durationDays") return "duration";
    if (key === "risk") return "risk preference";
    return key;
  };

  return (
    <div className="intent-search">
      <form className="intent-form" onSubmit={submit}>
        <label htmlFor="marketplace-intent">
          What do you want an agent to handle?
        </label>
        <div className="intent-control">
          <span aria-hidden="true">⌕</span>
          <Input
            id="marketplace-intent"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error !== null) setError(null);
            }}
            placeholder="Try “grid trader” or describe what you need"
          />
          <Button type="submit">Find verified agents</Button>
        </div>
      </form>
      {error === null ? null : <p className="intent-error" role="alert">{error}</p>}
      {Object.keys(understood).length > 0 ? (
        <div className="understanding" aria-live="polite">
          <span>Relic understands</span>
          {Object.entries(understood).map(([key, item]) => (
            <b key={key}>
              {fieldLabel(key)}: {label(key, item)}
            </b>
          ))}
        </div>
      ) : null}
    </div>
  );
}
