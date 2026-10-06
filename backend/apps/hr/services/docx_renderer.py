"""Word rendering with docxtpl inside a Jinja sandbox.

Templates are uploaded by trusted staff but are still treated as untrusted
code: SandboxedEnvironment blocks attribute/introspection tricks (SSTI),
autoescape XML-escapes the injected values, and StrictUndefined turns a typo
in a variable name into an explicit error instead of silent blanks.
"""

import io
import logging

from docxtpl import DocxTemplate
from jinja2 import StrictUndefined, TemplateError, nodes
from jinja2.sandbox import SandboxedEnvironment, SecurityError

from apps.hr.exceptions import HRDomainError

logger = logging.getLogger(__name__)


MAX_STRING_RESULT = 10_000          # largest str/list a template expression may build
MAX_TOTAL_OUTPUT = 1_000_000        # total chars emitted through {{ }} in one render
MAX_RENDERED_DOCX_BYTES = 20 * 1024 * 1024
MAX_POWER_EXPONENT = 64
# Constructs that can multiply work or escape the data-only contract.
_FORBIDDEN_NODES = (
    nodes.For, nodes.Macro, nodes.CallBlock, nodes.Import, nodes.FromImport,
    nodes.Include, nodes.Extends, nodes.Block,
)
_REMOVED_GLOBALS = ('range', 'lipsum', 'cycler', 'joiner', 'namespace', 'dict')
_REMOVED_FILTERS = ('center', 'indent', 'wordwrap')


class TemplateLimitError(SecurityError):
    """Raised by OUR limits; its message is Spanish and safe to show. Any other
    SecurityError comes from Jinja (English) and is replaced by a fixed text."""


class LimitedSandboxEnvironment(SandboxedEnvironment):
    """Sandbox with resource limits (SYSPCC-022 audit finding 2).

    Templates only need variables and `if`: loops, macros, includes and the
    generator globals are removed, repetition/concatenation/power results are
    capped, and the total emitted text is budgeted per render.
    """

    intercepted_binops = frozenset({'*', '**', '+'})

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in _REMOVED_GLOBALS:
            self.globals.pop(name, None)
        for name in _REMOVED_FILTERS:
            self.filters.pop(name, None)
        self.finalize = self._budgeted_finalize
        self._emitted = 0

    def _budgeted_finalize(self, value):
        self._emitted += len(str(value))
        if self._emitted > MAX_TOTAL_OUTPUT:
            raise TemplateLimitError('El resultado de la plantilla es demasiado grande.')
        return value

    def _parse(self, source, name, filename):
        parsed = super()._parse(source, name, filename)
        if parsed.find(_FORBIDDEN_NODES) is not None:
            raise TemplateLimitError(
                'La plantilla usa construcciones no permitidas (bucles, macros o inclusiones).'
            )
        return parsed

    def call_binop(self, context, operator, left, right):
        seq = (str, bytes, list, tuple)
        if operator == '*':
            for a, b in ((left, right), (right, left)):
                if isinstance(a, seq) and isinstance(b, int) and len(a) * max(b, 0) > MAX_STRING_RESULT:
                    raise TemplateLimitError('Repetición demasiado grande en la plantilla.')
        elif operator == '+':
            if isinstance(left, seq) and isinstance(right, seq):
                if len(left) + len(right) > MAX_STRING_RESULT:
                    raise TemplateLimitError('Concatenación demasiado grande en la plantilla.')
        elif operator == '**':
            if isinstance(right, int) and right > MAX_POWER_EXPONENT:
                raise TemplateLimitError('Potencia demasiado grande en la plantilla.')
        return super().call_binop(context, operator, left, right)


def build_env() -> SandboxedEnvironment:
    return LimitedSandboxEnvironment(autoescape=True, undefined=StrictUndefined)


def _load(source) -> DocxTemplate:
    """source: bytes | file-like | path."""
    if isinstance(source, (bytes, bytearray)):
        source = io.BytesIO(source)
    return DocxTemplate(source)


def _user_message(exc: TemplateError, *, syntax: bool) -> str:
    """Fixed es-PE text. Engine messages (English) never reach the user; only
    our own TemplateLimitError texts are shown."""
    if isinstance(exc, TemplateLimitError):
        return exc.message
    if isinstance(exc, SecurityError):
        return 'La plantilla usa construcciones no permitidas.'
    if syntax:
        return (
            'La plantilla tiene un error de sintaxis en los campos variables. '
            'Escribe cada {{ variable }} de una sola vez, sin cambiar de formato a mitad, '
            'y revisa que las llaves y las condiciones estén bien cerradas.'
        )
    return (
        'No se pudo rellenar la plantilla. Revisa que los nombres de las variables '
        'sean los de la guía de variables.'
    )


def detect_variables(source) -> list:
    """Variables used by the template (sorted). Raises HRDomainError on a
    syntax error or a corrupt file."""
    try:
        tpl = _load(source)
        return sorted(tpl.get_undeclared_template_variables(jinja_env=build_env()))
    except TemplateError as exc:
        logger.warning('hr.docx_syntax_error error_type=%s', type(exc).__name__)
        raise HRDomainError('template_syntax_error', _user_message(exc, syntax=True))
    except Exception as exc:  # noqa: BLE001 - corrupt docx internals raise many types
        logger.warning('hr.docx_detect_failed error_type=%s', type(exc).__name__)
        raise HRDomainError('invalid_docx', 'No se pudo leer el archivo Word.')


def render(source, context: dict) -> bytes:
    """Render the template with `context`; returns .docx bytes."""
    try:
        tpl = _load(source)
        tpl.render(context, jinja_env=build_env(), autoescape=True)
        out = io.BytesIO()
        tpl.save(out)
        if out.tell() > MAX_RENDERED_DOCX_BYTES:
            raise TemplateLimitError('El documento generado es demasiado grande.')
        return out.getvalue()
    except TemplateError as exc:
        # Type only: engine messages are English and may echo template/data fragments.
        logger.warning('hr.docx_render_failed error_type=%s', type(exc).__name__)
        raise HRDomainError('template_render_error', _user_message(exc, syntax=False), status_code=422)
    except HRDomainError:
        raise
    except Exception as exc:  # noqa: BLE001
        # Type only, never exc_info: tracebacks/locals could carry the render context (PII).
        logger.error('hr.docx_render_unexpected error_type=%s', type(exc).__name__)
        raise HRDomainError(
            'template_render_error', 'No se pudo generar el documento Word.', status_code=422,
        )
