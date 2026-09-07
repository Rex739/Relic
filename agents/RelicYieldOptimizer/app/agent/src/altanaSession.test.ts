import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { materializeAltanaSession } from "./altanaSession.js";

test("writes a valid injected session as an owner-only runtime file", () => {
  const path = join(mkdtempSync(join(tmpdir(), "relic-altana-")), ".studio/wallets/altana-session.json");
  materializeAltanaSession('{"session":"bounded"}', path);
  assert.equal(readFileSync(path, "utf8"), '{"session":"bounded"}');
  assert.equal(statSync(path).mode & 0o077, 0);
});

test("rejects empty, malformed, and non-object sessions", () => {
  const path = join(tmpdir(), "unused-session.json");
  assert.throws(() => materializeAltanaSession(undefined, path), /required/);
  assert.throws(() => materializeAltanaSession("not-json", path), /valid JSON/);
  assert.throws(() => materializeAltanaSession("[]", path), /JSON object/);
});
