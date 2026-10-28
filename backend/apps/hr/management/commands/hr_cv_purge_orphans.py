"""Delete CV files without a DB row (orphans) and, optionally, expired analyses.

    python manage.py hr_cv_purge_orphans [--dry-run]

Retention: with HR_CV_RETENTION_DAYS > 0 analyses older than N days are deleted
(rows + files). 0 (default) = off.
"""

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.hr.models import CVAnalysis, CVAnalysisItem
from apps.hr.services import cv_analysis_service
from apps.hr.storage import get_private_storage


def _walk(storage, base):
    try:
        dirs, files = storage.listdir(base)
    except (FileNotFoundError, OSError):
        return
    for f in files:
        yield f'{base}/{f}'
    for d in dirs:
        yield from _walk(storage, f'{base}/{d}')


class Command(BaseCommand):
    help = 'Purga archivos huérfanos de CVs y, si HR_CV_RETENTION_DAYS > 0, análisis vencidos.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Solo cuenta, no borra.')

    def handle(self, *args, **options):
        dry = options['dry_run']
        storage = get_private_storage()
        expired = 0
        if settings.HR_CV_RETENTION_DAYS > 0 and not dry:
            expired = cv_analysis_service.purge_expired(settings.HR_CV_RETENTION_DAYS)
        referenced = set()
        for f, r in CVAnalysisItem.objects.values_list('file', 'report_pdf'):
            referenced.update(n for n in (f, r) if n)
        # Job postings live under hr/cv/postings/: they MUST count as referenced,
        # otherwise the purge would delete the postings of live analyses.
        postings = CVAnalysis.objects.exclude(posting_file='').values_list('posting_file', flat=True)
        referenced.update(n for n in postings if n)
        orphans = [n for n in _walk(storage, 'hr/cv') if n not in referenced]
        if not dry:
            for name in orphans:
                storage.delete(name)
        self.stdout.write(f'Análisis vencidos eliminados: {expired}. Archivos huérfanos: {len(orphans)}'
                          f'{" (simulación)" if dry else " eliminados"}.')
