from .base import DomainPack, RubricItem, Slice, total_score
from .economics import ECONOMICS
from .general import GENERAL
from .medical import MEDICAL

DOMAINS: dict[str, DomainPack] = {d.id: d for d in (MEDICAL, ECONOMICS, GENERAL)}


def get_domain(domain_id: str | None) -> DomainPack:
    return DOMAINS.get(domain_id or "", GENERAL)


__all__ = ["DOMAINS", "DomainPack", "RubricItem", "Slice", "get_domain", "total_score"]
