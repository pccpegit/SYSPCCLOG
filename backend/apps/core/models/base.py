"""
Base abstract models shared across all apps.
"""

from django.db import models


class TimeStampedModel(models.Model):
    """
    Abstract base model that provides self-managed created_at and updated_at fields.
    All models in the project should inherit from this.
    """

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ['-created_at']
