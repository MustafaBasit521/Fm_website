"""The Render blueprint is configuration, so a test keeps its secrets out of the file."""

import re
from pathlib import Path

BLUEPRINT = (Path(__file__).resolve().parents[2] / "render.yaml").read_text()
SECRETS = [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "CORS_ORIGINS",
    "FRONTEND_URL",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
    "EMAIL_FROM",
    "CRON_SECRET",
]


def env_block(key: str) -> str:
    match = re.search(rf"- key: {key}\b[^\n]*\n((?:\s+[^-\s][^\n]*\n)+)", BLUEPRINT)
    assert match, f"{key} is missing from render.yaml"
    return match.group(1)


def test_every_secret_or_address_is_typed_in_the_dashboard_not_stored_here():
    for key in SECRETS:
        assert "sync: false" in env_block(key), key
        assert "value:" not in env_block(key), key


def test_the_api_runs_in_production_mode_behind_the_proxy():
    assert "value: production" in env_block("APP_ENV")
    assert 'value: "true"' in env_block("TRUST_PROXY_HEADERS")
    assert "--proxy-headers" in BLUEPRINT and "/api/health" in BLUEPRINT


def test_no_credential_looking_text_in_the_blueprint():
    for pattern in (
        r"postgres(ql)?(\+\w+)?://\w+:\w+@",
        r"eyJ[A-Za-z0-9_-]{20,}",
        r"sb_secret_",
        r"re_[A-Za-z0-9]{20,}",
    ):
        assert not re.search(pattern, BLUEPRINT), pattern
