from __future__ import annotations

import hashlib
from collections.abc import Mapping


ALLOWED_TRADE_TYPES: frozenset[str] = frozenset(
    {
        "usdt.trc20",
        "usdc.trc20",
        "usdt.erc20",
        "usdc.erc20",
        "usdt.polygon",
        "usdc.polygon",
        "usdt.bep20",
        "usdc.bep20",
        "usdt.aptos",
        "usdc.aptos",
        "usdt.solana",
        "usdc.solana",
        "usdt.xlayer",
        "usdc.xlayer",
        "usdt.arbitrum",
        "usdc.arbitrum",
        "usdt.plasma",
        "usdc.base",
    }
)


def normalize_base_url(url: str) -> str:
    return str(url or "").strip().rstrip("/")


def make_signature(params: Mapping[str, object], auth_token: str) -> str:
    token = str(auth_token or "").strip()
    items: list[tuple[str, str]] = []
    for key, value in params.items():
        if key == "signature":
            continue
        if value is None:
            continue
        value_str = str(value).strip()
        if not value_str:
            continue
        items.append((str(key), value_str))

    items.sort(key=lambda kv: kv[0])
    query = "&".join([f"{k}={v}" for k, v in items])
    raw = f"{query}{token}".encode("utf-8")
    return hashlib.md5(raw).hexdigest().lower()
