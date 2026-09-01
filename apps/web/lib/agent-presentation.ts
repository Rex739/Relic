export const defaultAgentImageUrl = "/agents/default-bot.png";

export function usableAgentImageUrl(value: string | null) {
  if (value === null) return defaultAgentImageUrl;
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
    return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : defaultAgentImageUrl;
  } catch {
    return defaultAgentImageUrl;
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
