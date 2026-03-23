from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

RuleType = Literal["page_rules", "redirect_rules", "cache_rules"]


class RulesReadRequest(BaseModel):
    account_id: str
    source_domain: str
    rule_types: list[RuleType] = Field(min_length=1)


class RulesReadResponse(BaseModel):
    domain: str
    rules: dict[str, list[dict]]


class RulesCloneRequest(BaseModel):
    account_id: str
    source_domain: str
    target_domains: list[str] = Field(min_length=1)
    rule_types: list[RuleType] = Field(min_length=1)
    selected_rules: dict[str, list[str]] | None = None


class RulesDeleteRequest(BaseModel):
    account_id: str
    domains: list[str] = Field(min_length=1)
    rule_types: list[RuleType] = Field(min_length=1)
    confirm: bool = False

