from __future__ import annotations

import json

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.core.exceptions import InternalError


class CredentialEncryption:
    def __init__(self, encryption_key: str):
        try:
            self._fernet = Fernet(encryption_key.encode())
        except Exception as e:  # noqa: BLE001
            raise InternalError("ENCRYPTION_KEY 无效，无法初始化加密组件") from e

    def encrypt(self, credentials: dict) -> str:
        data = json.dumps(credentials, ensure_ascii=False).encode("utf-8")
        return self._fernet.encrypt(data).decode("utf-8")

    def decrypt(self, encrypted: str) -> dict:
        try:
            data = self._fernet.decrypt(encrypted.encode("utf-8"))
        except InvalidToken as e:
            raise InternalError("凭据解密失败，请检查 ENCRYPTION_KEY 是否一致") from e
        return json.loads(data)


@lru_cache
def get_credential_encryption() -> CredentialEncryption:
    return CredentialEncryption(settings.ENCRYPTION_KEY)
