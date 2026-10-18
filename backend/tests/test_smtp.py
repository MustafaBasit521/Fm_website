import smtplib

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.email.base import EmailError, EmailMessage
from app.core.email.providers import SmtpEmailProvider, build_email_provider
from tests.test_engagement_infra import BASE

PASSWORD = "-".join(["not", "a", "real", "password"])
MSG = EmailMessage(to="sara@example.com", subject="Hello", body="Plain text body")


def settings(**over):
    return Settings(
        **BASE,
        email_provider="smtp",
        smtp_host="smtp.example.com",
        smtp_username="shop@example.com",
        smtp_password=PASSWORD,
        email_from="Bundle of Loops <shop@example.com>",
        _env_file=None,
        **over,
    )


class FakeServer:
    """Stands in for smtplib's connection and records what the provider does with it."""

    def __init__(self, fail_login=None, fail_send=None):
        self.calls: list[tuple] = []
        self.sent = None
        self._fail_login = fail_login
        self._fail_send = fail_send

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.calls.append(("quit",))

    def starttls(self, context=None):
        self.calls.append(("starttls", context is not None))

    def login(self, user, password):
        self.calls.append(("login", user))
        if self._fail_login:
            raise self._fail_login
        self.password_seen = password

    def send_message(self, msg):
        if self._fail_send:
            raise self._fail_send
        self.sent = msg
        self.calls.append(("send",))


def provider(server, **over):
    opened = []

    def connect(host, port):
        opened.append((host, port))
        return server

    p = SmtpEmailProvider(settings(**over), connect=connect)
    return p, opened


async def test_sends_one_message_with_the_right_headers_after_logging_in():
    server = FakeServer()
    p, opened = provider(server)
    await p.send(MSG)
    assert opened == [("smtp.example.com", 465)]
    assert [c[0] for c in server.calls] == [
        "login",
        "send",
        "quit",
    ]  # TLS from the start: no STARTTLS
    assert server.password_seen == PASSWORD
    sent = server.sent
    assert sent["From"] == "Bundle of Loops <shop@example.com>"
    assert (sent["To"], sent["Subject"]) == ("sara@example.com", "Hello")
    assert sent.get_content().strip() == "Plain text body"


async def test_other_ports_upgrade_to_tls_before_the_password_is_sent():
    server = FakeServer()
    p, opened = provider(server, smtp_port=587)
    await p.send(MSG)
    assert opened == [("smtp.example.com", 587)]
    assert [c[0] for c in server.calls][:2] == ["starttls", "login"]


async def test_a_refused_login_is_reported_without_the_password():
    server = FakeServer(fail_login=smtplib.SMTPAuthenticationError(535, b"bad credentials"))
    p, _ = provider(server)
    with pytest.raises(EmailError) as err:
        await p.send(MSG)
    assert "535" in str(err.value) and PASSWORD not in str(err.value)


@pytest.mark.parametrize(
    "failure", [smtplib.SMTPRecipientsRefused({}), smtplib.SMTPServerDisconnected(), TimeoutError()]
)
async def test_other_failures_become_email_errors(failure):
    p, _ = provider(FakeServer(fail_send=failure))
    with pytest.raises(EmailError, match="could not be sent"):
        await p.send(MSG)


def test_the_settings_need_everything_and_build_the_provider():
    for missing in ("smtp_host", "smtp_username", "smtp_password", "email_from"):
        values = {
            "smtp_host": "h",
            "smtp_username": "u",
            "smtp_password": PASSWORD,
            "email_from": "a@example.com",
        }
        values.pop(missing)
        with pytest.raises(ValidationError):
            Settings(**BASE, email_provider="smtp", _env_file=None, **values)
    assert isinstance(build_email_provider(settings()), SmtpEmailProvider)


def test_the_password_is_not_printed_with_the_settings():
    s = settings()
    assert PASSWORD not in repr(s) and PASSWORD not in str(s.model_dump())
