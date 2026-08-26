export function usableAgentImageUrl(value: string | null) {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function agentInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0]![0]}${words[1]![0]}`
      : (words[0]?.slice(0, 2) ?? "A")
  ).toUpperCase();
}

export function agentAvatarTone(id: string) {
  let hash = 0;
  for (const character of id)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `avatar-tone-${hash % 4}`;
}
