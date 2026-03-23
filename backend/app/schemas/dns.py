from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class DnsResolveDifferentValueItem(BaseModel):
    domain: str = Field(min_length=1)
    value: str = Field(min_length=1)


class DnsResolveCustomRecordItem(BaseModel):
    domain: str = Field(min_length=1)
    name: str = Field(min_length=1)
    type: str = Field(min_length=1)
    value: str = Field(min_length=1)
    ttl: int = Field(default=1, ge=1)
    proxied: bool | None = None


class DnsResolveSameValueRequest(BaseModel):
    mode: Literal["same_value"]
    account_id: str
    record_type: str = Field(min_length=1)
    record_name: str = Field(min_length=1)
    ttl: int = Field(default=1, ge=1)
    proxied: bool = False
    domains: list[str] = Field(min_length=1)
    record_value: str = Field(min_length=1)


class DnsResolveDifferentValueRequest(BaseModel):
    mode: Literal["different_value"]
    account_id: str
    record_type: str = Field(min_length=1)
    record_name: str = Field(min_length=1)
    ttl: int = Field(default=1, ge=1)
    proxied: bool = False
    records: list[DnsResolveDifferentValueItem] = Field(min_length=1)


class DnsResolveSiteGroupRequest(BaseModel):
    mode: Literal["site_group"]
    account_id: str
    record_type: str = Field(min_length=1)
    record_name: str = Field(min_length=1)
    ttl: int = Field(default=1, ge=1)
    proxied: bool = False
    domains: list[str] = Field(min_length=1)
    values: list[str] = Field(min_length=1)


class DnsResolveCustomRequest(BaseModel):
    mode: Literal["custom"]
    account_id: str
    records: list[DnsResolveCustomRecordItem] = Field(min_length=1)


DnsResolveRequest = Annotated[
    Union[
        DnsResolveSameValueRequest,
        DnsResolveDifferentValueRequest,
        DnsResolveSiteGroupRequest,
        DnsResolveCustomRequest,
    ],
    Field(discriminator="mode"),
]


class DnsReplaceRequest(BaseModel):
    account_id: str
    record_type: str = Field(min_length=1)
    record_name: str = Field(min_length=1)
    old_value: str = Field(min_length=1)
    new_value: str = Field(min_length=1)
    domains: list[str] = Field(min_length=1)


class DnsDeleteCustomItem(BaseModel):
    domain: str = Field(min_length=1)
    name: str = Field(min_length=1)
    type: str = Field(min_length=1)
    value: str | None = None


class DnsDeleteByRecordRequest(BaseModel):
    mode: Literal["by_record"]
    account_id: str
    record_type: str = Field(min_length=1)
    record_name: str = Field(min_length=1)
    record_value: str | None = None
    domains: list[str] = Field(min_length=1)


class DnsDeleteClearRequest(BaseModel):
    mode: Literal["clear"]
    account_id: str
    confirm: bool = False
    domains: list[str] = Field(min_length=1)


class DnsDeleteCustomRequest(BaseModel):
    mode: Literal["custom"]
    account_id: str
    records: list[DnsDeleteCustomItem] = Field(min_length=1)


DnsDeleteRequest = Annotated[
    Union[DnsDeleteByRecordRequest, DnsDeleteClearRequest, DnsDeleteCustomRequest],
    Field(discriminator="mode"),
]


class DnsProxyRequest(BaseModel):
    account_id: str
    record_name: str = Field(min_length=1)
    record_type: str | None = None
    proxied: bool
    domains: list[str] = Field(min_length=1)
