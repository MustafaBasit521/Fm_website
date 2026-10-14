"""N+1 guard: a list endpoint must run the same number of SQL statements whether the page has
3 rows or 9 (CLAUDE.md §18). Counts every statement sent to the database during one request."""

import uuid

import pytest
from sqlalchemy import event

from tests.conftest import auth
from tests.test_checkout import place


class Counter:
    def __init__(self, engine):
        self.engine = engine.sync_engine
        self.n = 0

    def _hit(self, *_a):
        self.n += 1

    def __enter__(self):
        event.listen(self.engine, "before_cursor_execute", self._hit)
        return self

    def __exit__(self, *_a):
        event.remove(self.engine, "before_cursor_execute", self._hit)


async def count(client, db_engine, path, headers=None) -> int:
    with Counter(db_engine) as c:
        r = await client.get(path, headers=headers)
    assert r.status_code == 200, (path, r.text)
    return c.n


async def grow(client, admin_h, make_product, alice, rows: int):
    """Add `rows` more of everything a list endpoint might join to."""
    for i in range(rows):
        p = await make_product(name=f"Item {uuid.uuid4().hex[:6]}", stock_quantity=20)
        pid = p["product_id"]
        for k in range(2):  # two pictures per product
            await client.post(
                f"/api/admin/products/{pid}/images",
                headers=admin_h,
                json={"storage_path": f"products/{pid}/{str(k) * 32}.jpg", "sort_order": k},
            )
        r = await place(client, [(pid, 1)], headers=alice)
        assert r.status_code == 201, r.text
        oid = r.json()["order_id"]
        for st in ("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"):
            await client.post(
                f"/api/admin/orders/{oid}/status", headers=admin_h, json={"status": st}
            )
        await client.post(
            f"/api/products/{pid}/reviews", headers=alice, json={"rating": 4, "comment": "ok"}
        )
        await client.post("/api/customers/me/wishlist", headers=alice, json={"product_id": pid})
        await client.post(
            "/api/custom-orders",
            headers=alice,
            json={"name": "A", "whatsapp_number": "0300 1234567", "description": f"d{i}"},
        )
        await client.post(
            "/api/contact", json={"name": "S", "email": "s@example.com", "message": "m"}
        )


ENDPOINTS = [
    ("/api/products?page_size=50", False),
    ("/api/orders?page_size=50", True),
    ("/api/customers/me/wishlist?page_size=50", True),
    ("/api/customers/me/notifications?page_size=50", True),
    ("/api/custom-orders?page_size=50", True),
    ("/api/admin/products?page_size=100", None),
    ("/api/admin/orders?page_size=100", None),
    ("/api/admin/customers?page_size=100", None),
    ("/api/admin/custom-orders?page_size=100", None),
    ("/api/admin/messages?page_size=100", None),
    ("/api/admin/reviews?page_size=100", None),
    ("/api/admin/dashboard", None),
    ("/api/admin/categories", None),
]


@pytest.mark.parametrize(("path", "as_customer"), ENDPOINTS)
async def test_list_endpoints_do_not_run_one_query_per_row(
    client, db_engine, admin_h, make_product, make_token, path, as_customer
):
    alice = auth(make_token(sub=uuid.uuid4(), email="alice@example.com", name="Alice"))
    headers = {True: alice, None: admin_h, False: None}[as_customer]
    await grow(client, admin_h, make_product, alice, 3)
    few = await count(client, db_engine, path, headers)
    await grow(client, admin_h, make_product, alice, 6)
    many = await count(client, db_engine, path, headers)
    assert many == few, f"{path}: {few} queries with 3 rows but {many} with 9 (N+1)"
