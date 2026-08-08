"""
Auto-generation of sequential RQ and PO numbers.
Format: RQ-YYYY-NNNN and OC-YYYY-NNNN.
Thread-safe via database-level locking.
"""

import re
from datetime import date
from django.db import transaction


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

        # Lock the latest RQ for this year to prevent race conditions
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
