import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

type ButtonVariant = "default" | "outline" | "destructive";
type ButtonSize = "default" | "sm" | "lg";

export function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  className?: string | undefined;
} = {}) {
  return cn(
    "ui-button",
    `ui-button-${variant}`,
    `ui-button-size-${size}`,
    className,
  );
}

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={buttonVariants({ variant, size, className })}
      type={type}
      {...props}
    />
  );
}
