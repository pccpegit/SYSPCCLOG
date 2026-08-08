"""
Business logic services for the support app.
"""

from apps.core.enums import TicketPriorityChoices, TicketCategoryChoices


# Keywords that escalate priority to CRITICAL (checked first)
_CRITICAL_KEYWORDS = [
    'urgente',
    'crítico',
    'critico',
    'caido',
    'caída',
    'caida',
    'no funciona',
    'bloqueado',
    'emergencia',
    'producción',
    'produccion',
]

# Keywords that escalate priority to HIGH (only if no critical keyword matched)
_HIGH_KEYWORDS = [
    'error',
    'falla',
    'no puedo',
    'lento',
    'problema',
]

# Categories that default to HIGH when no keywords match
_HIGH_PRIORITY_CATEGORIES = {
    TicketCategoryChoices.NETWORK,
    TicketCategoryChoices.ACCESS,
}


def auto_assign_priority(category: str, title: str, description: str) -> str:
    """
    Determine ticket priority based on category and keyword analysis.

    Rules (evaluated in order):
    1. Critical keywords in title or description → CRITICAL
    2. High keywords in title or description → HIGH
    3. NETWORK or ACCESS category → HIGH
    4. Default → MEDIUM

    Returns a TicketPriorityChoices value.
    """
    text = f"{title} {description}".lower()

    for keyword in _CRITICAL_KEYWORDS:
        if keyword in text:
            return TicketPriorityChoices.CRITICAL

    for keyword in _HIGH_KEYWORDS:
        if keyword in text:
            return TicketPriorityChoices.HIGH

    if category in _HIGH_PRIORITY_CATEGORIES:
        return TicketPriorityChoices.HIGH

    return TicketPriorityChoices.MEDIUM
