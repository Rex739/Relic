export const normalizeDeliveryContent = (
  value: unknown,
): Record<string, unknown> => {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object")
    throw new Error("Persisted delivery content must be a JSON object");
  return parsed as Record<string, unknown>;
};
