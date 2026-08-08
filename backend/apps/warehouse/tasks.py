"""
Celery tasks for the warehouse app.

Tasks
-----
upload_group_pdf_task   — Generate PDF for a MovementGroup and upload to OneDrive.
check_low_stock_alerts  — Scan inventory and log low-stock warnings.
"""
import logging

from celery import shared_task
from django.db import models

logger = logging.getLogger(__name__)


@shared_task(
    name='warehouse.upload_group_pdf',
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def upload_group_pdf_task(self, group_id: int):
    """
    Generate a multi-item PDF for a MovementGroup and upload it to OneDrive.
    Retries up to 3 times (60 s apart) on transient errors.
    Stores the sharing URL back on the group's document_url field.
    """
    from apps.warehouse.models import MovementGroup
    from apps.warehouse.services.pdf_generator import (
        generate_group_pdf,
        get_group_filename,
        get_group_month_folder,
    )
    from apps.warehouse.services.onedrive import OneDriveService

    try:
        group = (
            MovementGroup.objects
            .select_related('registered_by', 'project')
            .prefetch_related('movements', 'movements__inventory')
            .get(pk=group_id)
        )
    except MovementGroup.DoesNotExist:
        logger.error('upload_group_pdf_task: MovementGroup %s not found — skipping', group_id)
        return

    if not OneDriveService.is_connected():
        logger.info(
            'upload_group_pdf_task: OneDrive not connected — skipping upload for %s',
            group.group_number,
        )
        return

    try:
        pdf_bytes = generate_group_pdf(group)
        filename = get_group_filename(group)
        folder = get_group_month_folder(group)
        remote_path = f'{folder}/{filename}'

        url = OneDriveService.upload_file(pdf_bytes, remote_path)
        if url:
            MovementGroup.objects.filter(pk=group.pk).update(document_url=url)
            logger.info(
                'upload_group_pdf_task: Uploaded %s -> %s',
                group.group_number,
                url,
            )
        else:
            logger.warning(
                'upload_group_pdf_task: Upload returned no URL for %s',
                group.group_number,
            )
    except Exception as exc:
        logger.exception(
            'upload_group_pdf_task: Failed for group %s — will retry',
            group.group_number,
        )
        raise self.retry(exc=exc)


@shared_task(name='warehouse.check_low_stock')
def check_low_stock_alerts():
    """
    Scan all inventory items and send an email alert for items whose
    aggregated stock is at or below their minimum threshold.
    Runs daily at 7:30 AM via django-celery-beat.
    """
    from apps.warehouse.models import Inventory
    from django.conf import settings
    from django.core.mail import send_mail
    from django.db.models import Sum, DecimalField, Value, F
    from django.db.models.functions import Coalesce
    from django.utils import timezone

    items = list(
        Inventory.objects
        .annotate(
            total_stock=Coalesce(
                Sum('stocks__quantity'),
                Value(0),
                output_field=DecimalField(),
            )
        )
        .filter(total_stock__lte=F('min_stock'), min_stock__gt=0)
        .order_by('total_stock')
    )

    if not items:
        logger.info('check_low_stock_alerts: No items below minimum stock.')
        return '0 items with low stock — no email sent'

    # Log all items
    for item in items:
        logger.warning(
            'LOW STOCK: %s (%s) — Stock: %s, Min: %s',
            item.product_code,
            item.description,
            item.total_stock,
            item.min_stock,
        )

    # Build HTML email
    now = timezone.localtime().strftime('%d/%m/%Y %H:%M')
    critical = [i for i in items if float(i.total_stock) == 0]
    low = [i for i in items if float(i.total_stock) > 0]

    rows_html = ''
    for item in items:
        stock = float(item.total_stock)
        min_s = float(item.min_stock)
        deficit = min_s - stock
        color = '#dc2626' if stock == 0 else '#d97706'
        status = 'AGOTADO' if stock == 0 else 'BAJO'
        rows_html += f'''
        <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-family:monospace;font-size:12px;color:#6b7280;">{item.product_code}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#1f2937;">{item.description}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;font-size:12px;color:#6b7280;">{item.unit}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;color:{color};font-size:14px;">{stock:,.1f}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-size:13px;color:#6b7280;">{min_s:,.1f}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-size:13px;color:#dc2626;font-weight:600;">-{deficit:,.1f}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">
                <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:0.05em;color:white;background-color:{color};">{status}</span>
            </td>
        </tr>'''

    html_content = f'''
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:24px 32px;border-radius:16px 16px 0 0;">
            <h1 style="color:white;font-size:20px;margin:0;">Alerta de Stock Bajo</h1>
            <p style="color:#94a3b8;font-size:13px;margin:6px 0 0;">SYSPCC - Almacen Central &middot; {now}</p>
        </div>

        <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:24px 32px;border-radius:0 0 16px 16px;">
            <div style="display:flex;gap:16px;margin-bottom:24px;">
                <div style="flex:1;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;text-align:center;">
                    <p style="font-size:28px;font-weight:800;color:#dc2626;margin:0;">{len(critical)}</p>
                    <p style="font-size:11px;color:#991b1b;margin:4px 0 0;text-transform:uppercase;letter-spacing:0.1em;">Agotados</p>
                </div>
                <div style="flex:1;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;text-align:center;">
                    <p style="font-size:28px;font-weight:800;color:#d97706;margin:0;">{len(low)}</p>
                    <p style="font-size:11px;color:#92400e;margin:4px 0 0;text-transform:uppercase;letter-spacing:0.1em;">Stock bajo</p>
                </div>
                <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;text-align:center;">
                    <p style="font-size:28px;font-weight:800;color:#16a34a;margin:0;">{len(items)}</p>
                    <p style="font-size:11px;color:#166534;margin:4px 0 0;text-transform:uppercase;letter-spacing:0.1em;">Total alertas</p>
                </div>
            </div>

            <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                <thead>
                    <tr style="background:#f9fafb;">
                        <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;">Codigo</th>
                        <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;">Descripcion</th>
                        <th style="padding:10px 12px;text-align:center;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;">Unidad</th>
                        <th style="padding:10px 12px;text-align:right;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;">Stock</th>
                        <th style="padding:10px 12px;text-align:right;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;">Minimo</th>
                        <th style="padding:10px 12px;text-align:right;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;">Deficit</th>
                        <th style="padding:10px 12px;text-align:center;font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;">Estado</th>
                    </tr>
                </thead>
                <tbody>
                    {rows_html}
                </tbody>
            </table>

            <p style="font-size:11px;color:#9ca3af;margin:20px 0 0;text-align:center;">
                Este correo fue generado automaticamente por SYSPCC. No responda a este mensaje.
            </p>
        </div>
    </div>
    '''

    # Plain text fallback
    lines = [f'ALERTA DE STOCK BAJO - SYSPCC Almacen - {now}', '', f'{len(items)} items requieren atencion:', '']
    for item in items:
        stock = float(item.total_stock)
        lines.append(f'  {item.product_code} | {item.description} | Stock: {stock:,.1f} | Min: {float(item.min_stock):,.1f}')
    text_content = '\n'.join(lines)

    # Send email
    recipients = getattr(settings, 'WAREHOUSE_ALERT_RECIPIENTS', ['sistemas@pcc.com.pe'])
    try:
        send_mail(
            subject=f'[SYSPCC] Alerta: {len(items)} items con stock bajo ({len(critical)} agotados)',
            message=text_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipients,
            html_message=html_content,
            fail_silently=False,
        )
        logger.info('check_low_stock_alerts: Email sent to %s (%d items)', recipients, len(items))
    except Exception as exc:
        logger.error('check_low_stock_alerts: Failed to send email: %s', exc)

    return f'{len(items)} items with low stock — email sent to {recipients}'
