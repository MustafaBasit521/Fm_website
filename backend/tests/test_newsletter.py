import re
import uuid

import pytest

from app.core.rate_limit import limiter

URL = "/api/newsletter"


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def alice(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="alice@example.com", name="Alice Khan"))


@pytest.fixture
def bob(make_token):
    return auth(make_token(sub=uuid.uuid4(), email="bob@example.com", name="Bob Ali"))


async def join(client, email="Guest@Example.com"):
    r = await client.post(URL, json={"email": email})
    assert r.status_code == 200, r.text
    return r


def token_from(message) -> str:
    return re.search(r"unsubscribe\?token=([\w-]+)", message.body).group(1)


async def test_joining_sends_one_welcome_with_an_unsubscribe_link(client, emails):
    assert (await join(client)).json() == {"subscribed": True}
    sent = emails.to("guest@example.com")  # stored and written to lower-case
    assert len(sent) == 1 and "Welcome" in sent[0].subject
    assert token_from(sent[0])


async def test_joining_twice_gives_the_same_answer_and_no_second_email(client, emails):
    first = await join(client)
    second = await join(client)
    assert first.json() == second.json()
    assert len(emails.to("guest@example.com")) == 1


@pytest.mark.parametrize("email", ["", "nope", "a@", " "])
async def test_bad_addresses_are_refused(client, email):
    r = await client.post(URL, json={"email": email})
    assert r.status_code == 422


async def test_unsubscribing_with_the_link_token(client, emails, admin_h, make_product):
    await join(client)
    token = token_from(emails.to("guest@example.com")[0])
    r = await client.post(f"{URL}/unsubscribe", json={"token": token})
    assert r.status_code == 200
    emails.sent.clear()
    await make_product(name="After", is_visible=True)
    assert emails.sent == []  # no longer on the list
    again = await client.post(f"{URL}/unsubscribe", json={"token": token})
    assert again.status_code == 404  # the link is single-use


async def test_a_wrong_token_changes_nothing(client, emails):
    await join(client)
    r = await client.post(f"{URL}/unsubscribe", json={"token": "x" * 32})
    assert r.status_code == 404


async def test_new_product_emails_subscribers_and_updates_customers_once_each(
    client, admin_h, make_product, alice, bob, emails
):
    await client.get("/api/customers/me", headers=alice)
    await client.get("/api/customers/me", headers=bob)
    await client.patch("/api/customers/me", headers=bob, json={"subscribed_to_updates": False})
    await join(client, "visitor@example.com")
    await join(client, "alice@example.com")  # a customer who is also on the list
    emails.sent.clear()

    await make_product(name="Mint Frog", is_visible=True)

    got = {m.to: m for m in emails.sent if "Mint Frog" in m.subject}
    assert sorted(got) == ["alice@example.com", "visitor@example.com"]  # bob opted out
    assert len([m for m in emails.sent if m.to == "alice@example.com"]) == 1
    assert "unsubscribe?token=" in got["visitor@example.com"].body
    assert "/account" in got["alice@example.com"].body


async def test_hidden_products_send_nothing(client, make_product, emails):
    await join(client)
    emails.sent.clear()
    await make_product(name="Secret", is_visible=False)
    assert emails.sent == []


async def test_joining_is_rate_limited(client):
    limiter.enabled = True
    for i in range(5):
        assert (await client.post(URL, json={"email": f"p{i}@example.com"})).status_code == 200
    assert (await client.post(URL, json={"email": "p9@example.com"})).status_code == 429
