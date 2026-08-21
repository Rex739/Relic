"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  intentSearchParams,
  understandMarketplaceIntent,
} from "../../lib/marketplace";

export function IntentSearch({ initialValue = "" }: { initialValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const understood =
    value.trim().length > 3 ? understandMarketplaceIntent(value) : {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim().length < 2) return;
    router.push(`/marketplace?${intentSearchParams(value).toString()}`);
  };

  return (
    <div>
      <form className="intent-form" onSubmit={submit}>
        <label htmlFor="marketplace-intent">
          What do you want an agent to handle?
        </label>
        <div className="intent-control">
          <span aria-hidden="true">⌕</span>
          <input
            id="marketplace-intent"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Protect my Venus position from liquidation"
          />
          <button type="submit">Find verified agents</button>
        </div>
      </form>
      {Object.keys(understood).length > 0 ? (
        <div className="understanding" aria-live="polite">
          <span>Relic understands</span>
          {Object.entries(understood).map(([key, item]) => (
            <b key={key}>
              {key}: {item}
            </b>
          ))}
        </div>
      ) : null}
    </div>
  );
}
