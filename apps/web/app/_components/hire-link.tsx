"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

type HireLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

export function HireLink({ href, onClick, ...props }: HireLinkProps) {
  const router = useRouter();

  const beginHiring = async (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;

    event.preventDefault();
    try {
      const session = await fetch("/api/auth/session", { cache: "no-store" });
      if (session.ok) {
        router.push(href);
        return;
      }
    } catch {
      // The server-side hire route remains the fallback if the session check
      // cannot complete, so an unavailable network never bypasses the gate.
      router.push(href);
      return;
    }

    window.dispatchEvent(
      new CustomEvent("relic:open-connect", { detail: { returnTo: href } }),
    );
  };

  return <Link href={href} onClick={beginHiring} {...props} />;
}
