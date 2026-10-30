"""Pure startup guards (no settings access, so they are trivial to test).

SYSPCC-023 iteration 2: the simulated CV provider ("modo de prueba gratis")
returns made-up reports. It must never run where real decisions are taken, so
`fake` is refused unless DEBUG is on. production.py calls this with
DEBUG=False, so there `fake` always fails to boot.
"""

from django.core.exceptions import ImproperlyConfigured

CV_PROVIDERS = ('anthropic', 'fake')


def check_cv_provider_value(provider: str) -> str:
    if provider not in CV_PROVIDERS:
        raise ImproperlyConfigured(
            f'HR_CV_PROVIDER={provider!r} no es válido. Valores permitidos: {", ".join(CV_PROVIDERS)}.')
    return provider


def validate_cv_provider(provider: str, debug: bool) -> str:
    check_cv_provider_value(provider)
    if provider == 'fake' and not debug:
        raise ImproperlyConfigured(
            'HR_CV_PROVIDER=fake (modo de prueba) solo se permite con DEBUG=True. '
            'No se puede usar en producción.')
    return provider
