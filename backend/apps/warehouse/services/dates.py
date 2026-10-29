"""Display of the operational date of a movement (SYSPCC-025)."""

NO_DATE_LABEL = 'Sin fecha'
DISPLAY_DATE_FORMAT = '%d/%m/%Y'


def operational_date_label(movement_date) -> str:
    """
    ``dd/mm/aaaa`` of ``movement_date`` (the date the operation happened), or ``Sin fecha``.

    ``created_at`` is only the moment the row was registered (UTC) and differs from the
    operational date for retroactive loads and imported rows, so documents never show it as
    "the date of the movement". Rows imported without a date keep NULL on purpose.
    """
    if movement_date is None:
        return NO_DATE_LABEL
    return movement_date.strftime(DISPLAY_DATE_FORMAT)
