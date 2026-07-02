from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    relicApiBaseUrl: str
    relicAppUrl: str
    reviewAgentSeed: str
    verificationAgentSeed: str
    demoClientSeed: str
    reviewAgentPort: int
    verificationAgentPort: int
    demoClientPort: int
    verificationAgentAddress: str
    reviewAgentAddress: str
    reviewTimeoutSeconds: int


def _getenv(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _get_int(name: str, default: int) -> int:
    value = _getenv(name, str(default))
    try:
        return int(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer.") from exc


def _require_seed(name: str, value: str) -> None:
    if not value or value.startswith("replace-with"):
        raise RuntimeError(
            f"{name} is required. Copy agents/.env.example to agents/.env and set a long local seed."
        )


def loadSettings(requireSeeds: bool = True) -> Settings:
    settings = Settings(
        relicApiBaseUrl=_getenv("RELIC_API_BASE_URL", "http://127.0.0.1:3000").rstrip("/"),
        relicAppUrl=_getenv("RELIC_APP_URL", "http://127.0.0.1:3000").rstrip("/"),
        reviewAgentSeed=_getenv("RELIC_REVIEW_AGENT_SEED"),
        verificationAgentSeed=_getenv("RELIC_VERIFICATION_AGENT_SEED"),
        demoClientSeed=_getenv("RELIC_DEMO_CLIENT_SEED"),
        reviewAgentPort=_get_int("RELIC_REVIEW_AGENT_PORT", 8001),
        verificationAgentPort=_get_int("RELIC_VERIFICATION_AGENT_PORT", 8002),
        demoClientPort=_get_int("RELIC_DEMO_CLIENT_PORT", 8003),
        verificationAgentAddress=_getenv("RELIC_VERIFICATION_AGENT_ADDRESS"),
        reviewAgentAddress=_getenv("RELIC_REVIEW_AGENT_ADDRESS"),
        reviewTimeoutSeconds=_get_int("RELIC_REVIEW_TIMEOUT_SECONDS", 30),
    )

    if requireSeeds:
        _require_seed("RELIC_REVIEW_AGENT_SEED", settings.reviewAgentSeed)
        _require_seed("RELIC_VERIFICATION_AGENT_SEED", settings.verificationAgentSeed)
        _require_seed("RELIC_DEMO_CLIENT_SEED", settings.demoClientSeed)

    if settings.reviewTimeoutSeconds < 1:
        raise RuntimeError("RELIC_REVIEW_TIMEOUT_SECONDS must be at least 1.")

    return settings
