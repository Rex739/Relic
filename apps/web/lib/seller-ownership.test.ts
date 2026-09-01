import { describe, expect, it } from "vitest";

import {
  browserOwnerMismatchMessage,
  ownershipChallengeBytes,
  ownershipChallengeFilename,
  studioOwnershipProviderNotice,
  studioSigningCommand,
} from "./seller-ownership";

describe("seller ownership presentation", () => {
  it("downloads the exact canonical UTF-8 challenge without a BOM or newline", () => {
    const message = "Relic Agent Ownership Verification\n\nVersion: 1";
    const bytes = ownershipChallengeBytes(message);
    expect(new TextDecoder().decode(bytes)).toBe(message);
    expect([...bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.at(-1)).not.toBe(0x0a);
    expect(() => ownershipChallengeBytes(`${message}\n`)).toThrow(
      /not canonical/,
    );
  });

  it("uses the verified Agent Studio signing command and safe filename", () => {
    expect(ownershipChallengeFilename("2016", "challenge-abc")).toBe(
      "relic-agent-ownership-2016-challenge-abc.txt",
    );
    expect(studioSigningCommand("2016", "challenge-abc")).toBe(
      [
        'printf "Enter your Agent Studio wallet password: "',
        "read -rs WALLET_PASSWORD",
        'printf "\\n"',
        "export WALLET_PASSWORD",
        "",
        'message="$(<"$HOME/Downloads/relic-agent-ownership-2016-challenge-abc.txt")"',
        "",
        'if [ -x ".venv/bin/bag" ]; then BAG=".venv/bin/bag"; else BAG="bag"; fi',
        '"$BAG" wallet sign \\',
        "  --project-root . \\",
        '  --msg "$message"',
        "",
        "unset message",
        "unset WALLET_PASSWORD",
        "unset BAG",
      ].join("\n"),
    );
    expect(studioSigningCommand("2016", "challenge-abc")).toContain(
      "read -rs WALLET_PASSWORD",
    );
    expect(studioSigningCommand("2016", "challenge-abc")).toContain(
      "unset WALLET_PASSWORD",
    );
    expect(studioSigningCommand("2016", "challenge-abc")).toContain(
      "--project-root .",
    );
    expect(studioSigningCommand("2016", "challenge-abc")).not.toContain(
      "/absolute/path/to/your/agent",
    );
    expect(studioSigningCommand("2016", "challenge-abc")).not.toMatch(
      /--message|--file|--provider|--wallet/,
    );
  });

  it("explains wrong-owner and Altana boundaries", () => {
    const expected = "0x0000000000000000000000000000000000002016";
    expect(browserOwnerMismatchMessage("2016", expected)).toContain(expected);
    expect(browserOwnerMismatchMessage("2016", expected)).toContain(
      "does not own Agent #2016",
    );
    expect(studioOwnershipProviderNotice).toContain("evm-local");
    expect(studioOwnershipProviderNotice).toContain("TWAK");
    expect(studioOwnershipProviderNotice).toContain("Turnkey");
    expect(studioOwnershipProviderNotice).toContain(
      "Altana session keys are not ownership proof",
    );
  });
});
