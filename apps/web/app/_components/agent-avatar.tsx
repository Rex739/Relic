import {
  agentAvatarTone,
  agentInitials,
  usableAgentImageUrl,
} from "../../lib/agent-presentation";

export function AgentAvatar({
  id,
  imageUrl,
  name,
  size = "card",
}: {
  id: string;
  imageUrl: string | null;
  name: string;
  size?: "card" | "profile";
}) {
  const source = usableAgentImageUrl(imageUrl);
  return (
    <div
      className={`agent-avatar ${size === "profile" ? "large" : ""} ${agentAvatarTone(id)}`}
      aria-label={`${name} profile image`}
    >
      {source === null ? (
        <span aria-hidden="true">{agentInitials(name)}</span>
      ) : (
        <img src={source} alt="" referrerPolicy="no-referrer" />
      )}
    </div>
  );
}
