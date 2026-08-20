export interface EndpointReplacement {
  metadata: Record<string, unknown>;
  path: string;
}

export function replaceSingleEndpoint(
  current: Record<string, unknown>,
  oldEndpoint: string,
  newEndpoint: string,
): EndpointReplacement {
  const metadata = structuredClone(current);
  const matches: Array<{ container: Record<string, unknown>; path: string }> =
    [];

  const visit = (value: unknown, path = "$"): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`;
      if (key === "endpoint" && item === oldEndpoint)
        matches.push({
          container: value as Record<string, unknown>,
          path: itemPath,
        });
      else visit(item, itemPath);
    }
  };
  visit(metadata);

  if (matches.length !== 1)
    throw new Error(
      `Expected exactly one matching endpoint field; found ${matches.length}`,
    );
  matches[0]!.container.endpoint = newEndpoint;
  return { metadata, path: matches[0]!.path };
}
