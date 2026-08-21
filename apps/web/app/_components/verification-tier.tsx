import type { PublicVerificationTier } from "@relic/domain";

const explanations: Record<PublicVerificationTier, string> = {
  Working:
    "Relic independently reached and successfully invoked this agent recently.",
  Actionable:
    "Working, plus Relic verified the commerce and execution lifecycle.",
  Proven: "Reserved for agents with sufficient repeated real outcome evidence.",
};

export function VerificationTier({
  tier,
  explain = true,
}: {
  tier: PublicVerificationTier;
  explain?: boolean;
}) {
  return (
    <span className="tier-lockup">
      <span className={`tier tier-${tier.toLowerCase()}`}>● {tier}</span>
      {explain ? (
        <span
          className="tier-help"
          tabIndex={0}
          aria-label={`${tier}: ${explanations[tier]}`}
        >
          ?
          <span className="tier-tooltip" role="tooltip">
            <b>{tier}</b>
            {explanations[tier]}
          </span>
        </span>
      ) : null}
    </span>
  );
}
