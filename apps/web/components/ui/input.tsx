import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

/** The shared shadcn-style text input used in Relic forms. */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn("ui-input", className)} {...props} />;
}
