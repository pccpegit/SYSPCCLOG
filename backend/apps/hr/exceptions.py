"""Domain errors for the RR. HH. module.

They are DRF APIExceptions so the global EXCEPTION_HANDLER renders the
uniform envelope `{error, status_code, detail, code}` without a view-level
catch. The `detail` text is always user-facing Spanish (es-PE).
"""

from rest_framework import status
from rest_framework.exceptions import APIException


class HRDomainError(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = 'No se pudo completar la operación.'
    default_code = 'hr_error'

    def __init__(self, code: str, detail: str | None = None, status_code: int | None = None):
        if status_code is not None:
            self.status_code = status_code
        super().__init__(detail=detail or self.default_detail, code=code)
        self.code = code


def invalid_state(detail: str) -> HRDomainError:
    return HRDomainError('invalid_state', detail, status.HTTP_409_CONFLICT)
