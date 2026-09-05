"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps an order current while a wallet-submitted checkout operation waits for
 * blockchain finality. The server remains the source of truth; this only
 * refreshes the rendered snapshot until the durable status changes.
 */
export function CommerceStatusRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    router.refresh();
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, 2_500);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, router]);

  return null;
}
