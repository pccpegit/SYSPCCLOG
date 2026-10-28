"""SYSPCC-024: the DO spec tests must not be skipped silently in a full checkout.

`test_do_app_spec.py` is skipped when `.do/` is not mounted (the dev container
only sees ./backend). That is fine there, but in a real git checkout a missing
`.do/` means the spec and its scripts are not being verified: fail loudly.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]


def test_do_directory_is_present_in_a_git_checkout():
    if not (REPO_ROOT / '.git').exists():
        return  # not a checkout of the repo (e.g. container mounting only ./backend)

    assert (REPO_ROOT / '.do' / 'app.yaml').is_file(), (
        '.do/app.yaml falta en un checkout completo del repo: los tests del spec '
        'de DigitalOcean se omitirian sin verificar nada.'
    )
    assert (REPO_ROOT / '.do' / 'render_spec.py').is_file()
