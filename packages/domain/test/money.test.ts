import { describe, expect, it } from "vitest";

import {
  addDecimalAmounts,
  compareDecimalAmounts,
  formatBaseUnits,
  parseBaseUnits,
} from "../src/index.js";

describe("exact token amounts", () => {
  it.each([
    ["0.1", 6, 100_000n],
    ["0.01", 6, 10_000n],
    ["1.000001", 6, 1_000_001n],
    ["1", 0, 1n],
  ])("parses %s with %i decimals", (value, decimals, expected) => {
    expect(parseBaseUnits(value, decimals)).toBe(expected);
    expect(formatBaseUnits(expected, decimals)).toBe(value);
  });

  it("rejects negative, excessive precision, exponential, and unsafe decimals", () => {
    expect(() => parseBaseUnits("-1", 18)).toThrow();
    expect(() => parseBaseUnits("0.0000001", 6)).toThrow();
    expect(() => parseBaseUnits("1e18", 18)).toThrow();
    expect(() => parseBaseUnits("1", 78)).toThrow();
  });

  it("handles very large values without number conversion", () => {
    const value = "99999999999999999999999999999999999999.123456789012345678";
    const units = parseBaseUnits(value, 18);
    expect(formatBaseUnits(units, 18)).toBe(value);
  });

  it("compares and adds exact decimal values at equality boundaries", () => {
    expect(compareDecimalAmounts("0.1", "0.10")).toBe(0);
    expect(compareDecimalAmounts("1.000001", "1.000000")).toBe(1);
    expect(compareDecimalAmounts("0.01", "0.1")).toBe(-1);
    expect(addDecimalAmounts("0.1", "0.2")).toBe("0.3");
  });
});
