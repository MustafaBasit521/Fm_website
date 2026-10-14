import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AdminAuditLog(Base):
    """database.md §28: who did what at the admin boundary. Rows are only ever inserted by the
    audit middleware; nothing in the application updates or deletes them."""

    __tablename__ = "admin_audit_log"
    __table_args__ = (
        Index("ix_admin_audit_log_created_at", "created_at"),
        Index("ix_admin_audit_log_user_id", "user_id"),
    )

    audit_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The Supabase user id. No foreign key: the log must outlive any account.
    user_id: Mapped[uuid.UUID] = mapped_column()
    action: Mapped[str] = mapped_column(Text)  # e.g. "POST /api/admin/orders/{id}/cancel"
    path: Mapped[str] = mapped_column(Text)
    status_code: Mapped[int] = mapped_column(Integer)
    ip: Mapped[str | None] = mapped_column(Text)
    # clock_timestamp(): distinct times even for rows written within one transaction
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
