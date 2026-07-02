import { describe, expect, it } from "vitest";
import {
  getInitialVisibleAgentCount,
  isReviewComplete,
  nextVisibleAgentCount,
} from "@/lib/relic/reviewStaging";

describe("review staging", () => {
  it("starts staged reveal at zero when motion is allowed", () => {
    expect(getInitialVisibleAgentCount(5, false)).toBe(0);
  });

  it("immediately completes staged reveal when reduced motion is enabled", () => {
    expect(getInitialVisibleAgentCount(5, true)).toBe(5);
    expect(isReviewComplete(5, 5)).toBe(true);
  });

  it("never moves visible agent count backward when timers resolve out of order", () => {
    expect(nextVisibleAgentCount(4, 2)).toBe(4);
    expect(nextVisibleAgentCount(2, 4)).toBe(4);
  });
});
