"""es-PE formatters used to build template context (never done by the AI)."""

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from num2words import num2words

_MONTHS_ES = (
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
)

_CURRENCY = {
    # code: (symbol, singular, plural)
    'PEN': ('S/', 'SOL', 'SOLES'),
    'USD': ('US$', 'DÓLAR AMERICANO', 'DÓLARES AMERICANOS'),
}


_CENT = Decimal('0.01')


def quantize_money(amount) -> Decimal:
    """Single rounding rule for money in this module: 2 decimals, ROUND_HALF_UP
    (never the context default ROUND_HALF_EVEN). Accepts Decimal/str/int/float
    (floats go through str, not their binary representation)."""
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    return amount.quantize(_CENT, rounding=ROUND_HALF_UP)


def long_date_es(value: date | None) -> str:
    """date(2026, 11, 1) -> '1 de noviembre de 2026' (own month table: no OS locale)."""
    if value is None:
        return ''
    return f'{value.day} de {_MONTHS_ES[value.month - 1]} de {value.year}'


def short_date_es(value: date | None) -> str:
    return value.strftime('%d/%m/%Y') if value else ''


def money_symbol(currency: str) -> str:
    return _CURRENCY.get(currency, _CURRENCY['PEN'])[0]


def money_fmt(amount: Decimal, currency: str = 'PEN') -> str:
    """Decimal('2000') -> 'S/ 2,000.00'."""
    amount = quantize_money(amount)
    return f'{money_symbol(currency)} {amount:,.2f}'


_APOCOPE_BEFORE = r'(?= mil\b| millones\b| millón\b|$)'


def _apocopate(words: str) -> str:
    """'uno' -> 'un' and 'veintiuno' -> 'veintiún' when a noun follows (the
    currency, or mil/millones): 'veintiún mil', 'treinta y un', 'ciento un'."""
    words = re.sub(r'\bveintiuno' + _APOCOPE_BEFORE, 'veintiún', words)
    return re.sub(r'\buno' + _APOCOPE_BEFORE, 'un', words)


def money_to_words_es(amount: Decimal, currency: str = 'PEN') -> str:
    """Decimal('2000') -> 'DOS MIL Y 00/100 SOLES'.

    The integer part is spelled with num2words (lang='es'); cents are always
    expressed as NN/100. Only Decimal is accepted for the amount: a float
    would hide rounding errors in a legal document.
    """
    amount = quantize_money(amount)
    integer = int(amount)
    cents = int((amount - integer) * 100)
    words = num2words(integer, lang='es')
    words = _apocopate(words)
    _, singular, plural = _CURRENCY.get(currency, _CURRENCY['PEN'])
    noun = singular if integer == 1 else plural
    return f'{words.upper()} Y {cents:02d}/100 {noun}'
