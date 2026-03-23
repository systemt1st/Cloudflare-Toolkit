from __future__ import annotations

import httpx

from app.config import settings
from app.core.exceptions import InternalError, ValidationError


async def send_email(*, to: str, subject: str, html: str) -> None:
    if not settings.RESEND_API_KEY:
        raise ValidationError("未配置 RESEND_API_KEY，无法发送邮件")

    payload = {
        "from": settings.RESEND_FROM,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    headers = {"Authorization": f"Bearer {settings.RESEND_API_KEY}"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post("https://api.resend.com/emails", json=payload, headers=headers)
    except Exception as e:  # noqa: BLE001
        raise InternalError("发送邮件失败") from e

    if resp.status_code >= 400:
        raise InternalError("发送邮件失败")

