from django.apps import AppConfig


class RQConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.rq'
    verbose_name = 'Requerimientos (RQ)'

    def ready(self):
        import apps.rq.signals  # noqa: F401
