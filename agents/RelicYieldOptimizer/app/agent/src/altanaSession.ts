import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Materializes the Northflank-injected bounded session only at process start.
 * The session is never accepted over HTTP, returned by an endpoint, or baked
 * into an image. The Studio runtime reads this conventional local path.
 */
export function materializeAltanaSession(
  session: string | undefined,
  path: string,
): void {
  const value = session?.trim();
  if (!value) throw new Error("ALTANA_SESSION is required for the private executor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("ALTANA_SESSION must contain valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ALTANA_SESSION must contain a JSON object");
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Overwrite at startup so an intentionally rotated Northflank secret wins.
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600 });
}
