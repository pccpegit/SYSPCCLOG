"""
SYSPCC-026 (Fase 1, QA ronda 2): the Django admin (`/mgmt-panel/`) after the new fields.

Nothing in the suite loaded these admin pages, and a misconfigured admin only fails
when someone opens it. Covered here:

  * the Request changelist renders and filters by the new `requesting_area`;
  * the change page renders a request with historical lines (no area, no source, no
    link), with a proposed link and with a confirmed one;
  * the provenance of the link (`inventory_item_confirmed_at/_by`) is READ-ONLY there
    (it is stamped by logistics through update-items, never by hand);
  * a line cannot be both linked to a product and off-catalog: the inline form shows
    a field error instead of letting the DB CHECK constraint raise a 500.
"""
from datetime import timedelta

import pytest
from django.contrib import admin as django_admin
from django.test import Client, RequestFactory
from django.urls import reverse
from django.utils import timezone

from apps.rq.admin import RequestAdmin, RequestItemInline
from apps.rq.models import Request, RequestItem
from apps.rq.tests.catalog_fixtures import (  # noqa: F401  (fixtures)
    adm_rq,
    logistics_supervisor,
    make_inventory,
    make_item,
    make_request,
    ops_rq,
)


@pytest.fixture
def admin_http(superuser):
    client = Client()
    client.force_login(superuser)
    return client


@pytest.fixture
def helmet(db):
    return make_inventory('EPP-0001', 'Casco de seguridad blanco')


@pytest.fixture
def mixed_rq(ops_rq, helmet, logistics_supervisor):
    """One RQ with every kind of line the admin can meet."""
    ops_rq.requesting_area = 'OP'
    ops_rq.save(update_fields=['requesting_area'])
    make_item(ops_rq, 1, description='Línea histórica')  # no source, no link
    make_item(ops_rq, 2, description='Propuesto', inventory_item=helmet, item_source='EPP')
    make_item(
        ops_rq, 3, description='Confirmado', inventory_item=helmet, item_source='EPP',
        inventory_item_confirmed_at=timezone.now() - timedelta(hours=1),
        inventory_item_confirmed_by=logistics_supervisor,
    )
    make_item(ops_rq, 4, description='Servicio', is_off_catalog=True, item_source='MATERIALES')
    return ops_rq


@pytest.mark.django_db
class TestRequestChangelist:
    def test_it_renders_with_historical_and_new_requests(self, admin_http, ops_rq, adm_rq, mixed_rq):
        response = admin_http.get(reverse('admin:rq_request_changelist'))

        assert response.status_code == 200
        content = response.content.decode()
        assert 'RQ-2026-0501' in content and 'RQ-2026-0502' in content

    def test_the_area_filter_is_offered_and_narrows_the_list(self, admin_http, ops_rq, adm_rq):
        ops_rq.requesting_area = 'OP'
        ops_rq.save(update_fields=['requesting_area'])
        adm_rq.requesting_area = 'ADM'
        adm_rq.save(update_fields=['requesting_area'])

        everything = admin_http.get(reverse('admin:rq_request_changelist'))
        only_op = admin_http.get(reverse('admin:rq_request_changelist'), {'requesting_area__exact': 'OP'})

        assert 'requesting_area__exact=OP' in everything.content.decode()  # the filter sidebar links to it
        assert only_op.status_code == 200
        content = only_op.content.decode()
        assert 'RQ-2026-0501' in content
        assert 'RQ-2026-0502' not in content

    def test_a_historical_request_without_area_is_still_listed_without_a_filter(self, admin_http, ops_rq):
        response = admin_http.get(reverse('admin:rq_request_changelist'))

        assert response.status_code == 200
        assert 'RQ-2026-0501' in response.content.decode()

    def test_a_filter_value_that_does_not_exist_is_a_clean_redirect_not_a_500(self, admin_http, ops_rq):
        response = admin_http.get(reverse('admin:rq_request_changelist'), {'requesting_area__exact': 'ZZZ'})

        assert response.status_code in (200, 302)


@pytest.mark.django_db
class TestRequestChangePage:
    def test_it_renders_every_kind_of_line(self, admin_http, mixed_rq):
        response = admin_http.get(reverse('admin:rq_request_change', args=[mixed_rq.pk]))

        assert response.status_code == 200
        content = response.content.decode()
        for description in ('Línea histórica', 'Propuesto', 'Confirmado', 'Servicio'):
            assert description in content

    def test_a_historical_request_with_no_lines_metadata_renders(self, admin_http, ops_rq):
        make_item(ops_rq, 1)

        response = admin_http.get(reverse('admin:rq_request_change', args=[ops_rq.pk]))

        assert response.status_code == 200

    def test_the_confirmation_stamp_is_not_an_editable_input(self, admin_http, mixed_rq):
        response = admin_http.get(reverse('admin:rq_request_change', args=[mixed_rq.pk]))

        content = response.content.decode()
        assert 'name="items-0-inventory_item"' in content            # the link IS editable (raw id)
        assert 'name="items-0-is_off_catalog"' in content
        assert 'name="items-0-inventory_item_confirmed_at' not in content
        assert 'name="items-0-inventory_item_confirmed_by"' not in content

    def test_the_catalog_link_uses_a_raw_id_widget_not_a_giant_select(self, admin_http, mixed_rq, helmet):
        for n in range(30):
            make_inventory(f'EPP-9{n:03d}', f'Producto de relleno {n}')

        response = admin_http.get(reverse('admin:rq_request_change', args=[mixed_rq.pk]))

        content = response.content.decode()
        assert 'Producto de relleno 29' not in content  # the catalog is not dumped into a <select>

    def test_the_admin_registers_the_area_in_its_filters(self):
        admin_class = django_admin.site._registry[Request]

        assert isinstance(admin_class, RequestAdmin)
        assert 'requesting_area' in admin_class.list_filter


@pytest.mark.django_db
class TestInlineFormValidation:
    @pytest.fixture
    def formset_class(self, superuser, ops_rq):
        request = RequestFactory().get('/')
        request.user = superuser
        inline = RequestItemInline(Request, django_admin.site)
        return inline.get_formset(request, ops_rq)

    @staticmethod
    def _data(formset_class, **fields):
        prefix = formset_class.get_default_prefix()
        base = {'line_number': '1', 'description': 'Casco', 'quantity': '2', 'unit': 'UND'}
        base.update(fields)
        data = {
            f'{prefix}-TOTAL_FORMS': '1',
            f'{prefix}-INITIAL_FORMS': '0',
            f'{prefix}-MIN_NUM_FORMS': '0',
            f'{prefix}-MAX_NUM_FORMS': '1000',
        }
        data.update({f'{prefix}-0-{name}': value for name, value in base.items()})
        return data

    def test_a_linked_line_cannot_also_be_off_catalog(self, formset_class, ops_rq, helmet):
        data = self._data(formset_class, inventory_item=str(helmet.pk), is_off_catalog='on')

        formset = formset_class(data=data, instance=ops_rq)

        assert not formset.is_valid()
        assert 'is_off_catalog' in formset.forms[0].errors
        assert not RequestItem.objects.filter(request=ops_rq).exists()

    @pytest.mark.parametrize('fields', [
        {},                                                    # nothing chosen (historical shape)
        {'is_off_catalog': 'on'},                              # off-catalog alone
        {'inventory_item': '__helmet__'},                      # product alone
        {'inventory_item': '__helmet__', 'item_source': 'EPP'},
    ])
    def test_every_other_combination_saves(self, formset_class, ops_rq, helmet, fields):
        fields = {k: (str(helmet.pk) if v == '__helmet__' else v) for k, v in fields.items()}

        formset = formset_class(data=self._data(formset_class, **fields), instance=ops_rq)

        assert formset.is_valid(), formset.errors
        formset.save()
        assert RequestItem.objects.filter(request=ops_rq).count() == 1

    def test_an_unknown_source_is_refused(self, formset_class, ops_rq):
        formset = formset_class(data=self._data(formset_class, item_source='NO_EXISTE'), instance=ops_rq)

        assert not formset.is_valid()
        assert 'item_source' in formset.forms[0].errors

    def test_a_zero_quantity_is_refused_by_the_form(self, formset_class, ops_rq):
        formset = formset_class(data=self._data(formset_class, quantity='0'), instance=ops_rq)

        assert not formset.is_valid()
        assert 'quantity' in formset.forms[0].errors

    def test_the_stamp_cannot_be_forged_through_the_form(self, formset_class, ops_rq, helmet, superuser):
        data = self._data(
            formset_class, inventory_item=str(helmet.pk),
            inventory_item_confirmed_at='2026-01-01 00:00:00', inventory_item_confirmed_by=str(superuser.pk),
        )

        formset = formset_class(data=data, instance=ops_rq)

        assert formset.is_valid(), formset.errors
        formset.save()
        line = RequestItem.objects.get(request=ops_rq)
        assert line.inventory_item_confirmed_at is None
        assert line.inventory_item_confirmed_by is None
        assert line.link_confirmed is False
