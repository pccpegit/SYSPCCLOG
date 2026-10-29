"""Domain errors of the inventory importer (mapped to HTTP responses by the view)."""


class ImportRejected(Exception):
    """Base class: ``code`` is a stable machine-readable identifier, ``message`` is es-PE."""

    http_status = 400

    def __init__(self, code: str, message: str, **extra):
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra


class ImportFileError(ImportRejected):
    """The uploaded file itself is unusable (not an .xlsx, too big, hostile, unreadable...). 400."""

    http_status = 400


class ImportNotConfirmable(ImportRejected):
    """The request cannot be confirmed as sent (blockers, missing acceptances, bad maps). 400."""

    http_status = 400


class ImportConflict(ImportRejected):
    """State conflict: file already imported, plan changed, expired, concurrent confirm. 409."""

    http_status = 409
