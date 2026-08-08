"""
Core app signals.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver


# Signals are defined here and connected in apps.py via ready()
# Add signals as needed, e.g., notify admin when new user is created.
