"""
RQ app signals.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

# Signals are connected here via ready() in apps.py
# Example: auto-create notifications when request status changes.
# Prefer using the WorkflowEngine's built-in notification logic
# instead of signals to keep the workflow transactional.
