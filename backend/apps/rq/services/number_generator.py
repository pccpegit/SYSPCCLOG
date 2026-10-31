"""
Auto-generation of sequential RQ and PO numbers.
Format: RQ-YYYY-NNNN and OC-YYYY-NNNN.
Thread-safe via database-level locking.
"""

import re
import zlib
from datetime import date
from django.db import connection, transaction


def _serialize_sequence(prefix: str) -> None:
    """
    Serialize every generator of the sequence `prefix` (e.g. 'RQ-2026-') until the end of
    the CURRENT TRANSACTION (the caller's, not just the savepoint of `generate`).

    `SELECT ... FOR UPDATE ... LIMIT 1` on the latest row does not serialize anything: all
    concurrent callers lock the SAME current latest row and, once it is released, each
    computes the same "next" number (the new row is not in the first one's lock set), so
    all but one then collide on the unique constraint. A transaction-scoped advisory lock on
    the sequence does: the next caller waits until the previous one committed, and its
    READ COMMITTED query then sees the number just taken. PostgreSQL only; SQLite has a
    single writer and needs nothing.
    """
    if connection.vendor != 'postgresql':
        return
    key = zlib.crc32(prefix.encode('utf-8'))  # stable 32-bit key per sequence and year
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock(%s, %s)', [0x5359, key - 2**31])


class RQNumberGenerator:
    """
    Generates sequential RQ numbers in the format RQ-YYYY-NNNN.
    Uses SELECT FOR UPDATE to prevent duplicate numbers under concurrent load.
    """

    PREFIX = 'RQ'
    PADDING = 4

    @classmethod
    @transaction.atomic
    def generate(cls) -> str:
        """
        Generate the next RQ number for the current year.
        Acquires a row-level lock on the latest RQ to ensure sequential uniqueness.
        """
        from apps.rq.models import Request

        year = date.today().year
        prefix = f'{cls.PREFIX}-{year}-'

        _serialize_sequence(prefix)
        # (the row lock below stays as an extra guard; the advisory lock is what serializes)
        latest = (
            Request.objects
            .filter(rq_number__startswith=prefix)
            .select_for_update()
            .order_by('-rq_number')
            .first()
        )

        if latest:
            # Extract the sequence number from the last RQ
            match = re.search(r'(\d+)$', latest.rq_number)
            last_seq = int(match.group(1)) if match else 0
        else:
            last_seq = 0

        next_seq = last_seq + 1
        return f'{prefix}{str(next_seq).zfill(cls.PADDING)}'


class PONumberGenerator:
    """
    Generates sequential PO (Orden de Compra) numbers in the format OC-YYYY-NNNN.
    """

    PREFIX = 'OC'
    PADDING = 4

    @classmethod
    @transaction.atomic
    def generate(cls) -> str:
        """
        Generate the next OC number for the current year.
        Acquires a row-level lock on the latest PO to ensure sequential uniqueness.
        """
        from apps.rq.models import PurchaseOrder

        year = date.today().year
        prefix = f'{cls.PREFIX}-{year}-'

        _serialize_sequence(prefix)
        latest = (
            PurchaseOrder.objects
            .filter(po_number__startswith=prefix)
            .select_for_update()
            .order_by('-po_number')
            .first()
        )

        if latest:
            match = re.search(r'(\d+)$', latest.po_number)
            last_seq = int(match.group(1)) if match else 0
        else:
            last_seq = 0

        next_seq = last_seq + 1
        return f'{prefix}{str(next_seq).zfill(cls.PADDING)}'
