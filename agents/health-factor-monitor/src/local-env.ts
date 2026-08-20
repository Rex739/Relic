import { existsSync } from "node:fs";
import { join } from "node:path";

export const loadLocalEnvironment = (root: string) => {
  const loaded: string[] = [];
  for (const name of [".env.local", ".env"]) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    process.loadEnvFile(path);
    loaded.push(name);
  }
  return loaded;
};
