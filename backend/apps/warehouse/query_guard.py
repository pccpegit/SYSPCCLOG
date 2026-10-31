"""
Query-string guard shared by the warehouse viewsets.

PostgreSQL text cannot hold a NUL byte (``%00``) and psycopg2 refuses to send one, so a filter such
as ``?search=%00`` that works on SQLite becomes an unhandled ``ValueError`` -> HTTP 500 in
production. Request bodies are already covered (DRF's ``CharField`` prohibits NUL characters); the
filters read straight from ``request.query_params`` are not, so they are checked here once, before
any view code builds a query. The check also runs on SQLite so development and CI behave like
production.
"""
from rest_framework.exceptions import ValidationError

NUL = '\x00'
INVALID_PARAMETER_MESSAGE = 'El valor contiene caracteres no válidos.'


def find_nul_parameter(query_params):
    """Name of the first query parameter whose name or value carries a NUL byte, else ``None``."""
    for key, values in query_params.lists():
        if NUL in key or any(NUL in value for value in values):
            return key
    return None


class RejectNulQueryParamsMixin:
    """
    Answer 400 (project error envelope) when any query parameter contains a NUL byte.

    Runs after authentication, permissions and throttling (``super().initial``), so an anonymous
    caller still gets 401/403 and never learns anything about the filters.
    """

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        offender = find_nul_parameter(request.query_params)
        if offender is not None:
            # The name goes back to the caller, so it must not carry the NUL itself.
            name = offender.replace(NUL, '') or 'query'
            raise ValidationError({name: INVALID_PARAMETER_MESSAGE})
