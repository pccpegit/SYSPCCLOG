"""
PDF generator for warehouse movement vouchers (vales de entrada/salida).
Uses ReportLab to produce clean, professional PDF documents.
"""
import io
import os
from datetime import datetime

from django.conf import settings

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT


WAREHOUSE_LABELS = {
    'CENTRAL': 'Almacen Central',
    'SITE': 'Almacen de Obra',
    'OFFICE': 'Almacen/Bodega Oficina',
}

SOURCE_LABELS = {
    'PURCHASE': 'Compra',
    'RETURN': 'Devolucion',
    'TRANSFER_IN': 'Traslado entrante',
    'INITIAL_LOAD': 'Carga inicial',
}

DEST_LABELS = {
    'PROJECT': 'Proyecto / Obra',
    'DEPARTMENT': 'Area / Depto.',
    'EMPLOYEE': 'Colaborador',
}


def generate_movement_pdf(movement) -> bytes:
    """
    Generate a PDF voucher for an InventoryMovement.
    Returns the PDF content as bytes.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        'DocTitle',
        parent=styles['Title'],
        fontSize=16,
        spaceAfter=2 * mm,
    ))
    styles.add(ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.grey,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        'FieldLabel',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.Color(0.4, 0.4, 0.4),
    ))
    styles.add(ParagraphStyle(
        'FieldValue',
        parent=styles['Normal'],
        fontSize=10,
        leading=14,
    ))
    styles.add(ParagraphStyle(
        'SmallCenter',
        parent=styles['Normal'],
        fontSize=8,
        alignment=TA_CENTER,
        textColor=colors.Color(0.5, 0.5, 0.5),
    ))

    elements = []
    is_entry = movement.movement_type == 'ENTRY'
    doc_type = 'VALE DE ENTRADA' if is_entry else 'VALE DE SALIDA'

    # ── Header ────────────────────────────────────────────────────────────
    logo_path = os.path.join(settings.BASE_DIR, 'static', 'images', 'pcc_logo.png')
    if os.path.exists(logo_path):
        logo = Image(logo_path, width=30 * mm, height=15 * mm, kind='proportional')
        header_data = [[
            logo,
            Paragraph(
                '<b>PCC S.A.C.</b><br/>'
                '<font size="8" color="#888888">Proyectos, Construccion &amp; Comisionamiento</font>',
                ParagraphStyle('HeaderText', parent=styles['Normal'], fontSize=14, leading=18),
            ),
        ]]
        header_table = Table(header_data, colWidths=[35 * mm, doc.width - 35 * mm])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (0, 0), 0),
        ]))
        elements.append(header_table)
    else:
        elements.append(Paragraph('PCC S.A.C.', styles['DocTitle']))
        elements.append(Paragraph(
            'Proyectos, Construccion & Comisionamiento',
            styles['DocSubtitle'],
        ))
    elements.append(Spacer(1, 6 * mm))

    # ── Document title & number ───────────────────────────────────────────
    title_data = [
        [
            Paragraph(f'<b>{doc_type}</b>', ParagraphStyle(
                'TitleLeft', parent=styles['Normal'], fontSize=14,
            )),
            Paragraph(
                f'<b>{movement.movement_number}</b>',
                ParagraphStyle('TitleRight', parent=styles['Normal'],
                               fontSize=12, alignment=TA_RIGHT,
                               textColor=colors.Color(0.2, 0.2, 0.2)),
            ),
        ],
    ]
    title_table = Table(title_data, colWidths=[doc.width * 0.6, doc.width * 0.4])
    title_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 0), (-1, 0), 1.5, colors.Color(0.1, 0.1, 0.1)),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
    ]))
    elements.append(title_table)
    elements.append(Spacer(1, 5 * mm))

    # ── Info block ────────────────────────────────────────────────────────
    date_str = movement.created_at.strftime('%d/%m/%Y %H:%M')
    wh_label = WAREHOUSE_LABELS.get(movement.warehouse, movement.warehouse)
    project_name = movement.project.name if movement.project else '-'

    info_rows = [
        [_field('Fecha', date_str, styles), _field('Almacen', wh_label, styles)],
        [_field('Proyecto', project_name, styles), ''],
    ]

    if is_entry:
        source = SOURCE_LABELS.get(movement.source_type, movement.source_type)
        info_rows[1][1] = _field('Origen', source, styles)
        if movement.supplier_name:
            info_rows.append([
                _field('Proveedor', movement.supplier_name, styles),
                _field('N. Factura / Guia', movement.invoice_number or '-', styles),
            ])
    else:
        dest = DEST_LABELS.get(movement.destination_type, movement.destination_type)
        info_rows[1][1] = _field('Tipo destino', dest, styles)
        if movement.destination_detail:
            info_rows.append([
                _field('Destino', movement.destination_detail, styles),
                _field('Solicitado por', movement.requested_by.get_full_name() if movement.requested_by else '-', styles),
            ])

    info_table = Table(info_rows, colWidths=[doc.width * 0.5, doc.width * 0.5])
    info_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 6 * mm))

    # ── Item table ────────────────────────────────────────────────────────
    item_header = ['Codigo', 'Descripcion', 'Unidad', 'Cantidad']
    item_row = [
        movement.inventory.product_code,
        movement.inventory.description,
        movement.inventory.unit.capitalize(),
        f'{movement.quantity:,.3f}',
    ]

    item_table = Table(
        [item_header, item_row],
        colWidths=[doc.width * 0.18, doc.width * 0.42, doc.width * 0.18, doc.width * 0.22],
    )
    item_table.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), colors.Color(0.12, 0.12, 0.12)),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        # Data
        ('FONTSIZE', (0, 1), (-1, -1), 10),
        ('TOPPADDING', (0, 1), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 10),
        ('BACKGROUND', (0, 1), (-1, -1), colors.Color(0.97, 0.97, 0.97)),
        # Alignment
        ('ALIGN', (3, 0), (3, -1), 'RIGHT'),
        # Grid
        ('GRID', (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.85, 0.85)),
        ('ROUNDEDCORNERS', [4, 4, 4, 4]),
    ]))
    elements.append(item_table)

    # ── Notes ─────────────────────────────────────────────────────────────
    if movement.notes:
        elements.append(Spacer(1, 5 * mm))
        elements.append(Paragraph(
            f'<b>Observaciones:</b> {movement.notes}',
            ParagraphStyle('Notes', parent=styles['Normal'], fontSize=9,
                           textColor=colors.Color(0.3, 0.3, 0.3)),
        ))

    # ── Signature block ───────────────────────────────────────────────────
    elements.append(Spacer(1, 15 * mm))

    registered_name = movement.registered_by.get_full_name()
    authorized_name = movement.authorized_by.get_full_name() if movement.authorized_by else ''

    # Load signature images if they exist
    reg_sig = _get_signature_image(movement.registered_by)
    auth_sig = _get_signature_image(movement.authorized_by) if movement.authorized_by else ''

    sig_data = [
        [reg_sig, '', auth_sig],
        [
            '____________________',
            '____________________',
            '____________________',
        ],
        [
            Paragraph('<b>Entrego</b>', styles['SmallCenter']),
            Paragraph('<b>Recibio</b>', styles['SmallCenter']),
            Paragraph('<b>Autorizo</b>', styles['SmallCenter']),
        ],
        [
            Paragraph(registered_name, styles['SmallCenter']),
            Paragraph('', styles['SmallCenter']),
            Paragraph(authorized_name, styles['SmallCenter']),
        ],
    ]

    sig_table = Table(sig_data, colWidths=[doc.width / 3] * 3)
    sig_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, 0), 'BOTTOM'),
        ('TOPPADDING', (0, 2), (-1, 2), 4),
        ('TOPPADDING', (0, 3), (-1, 3), 2),
    ]))
    elements.append(sig_table)

    # ── Footer ────────────────────────────────────────────────────────────
    elements.append(Spacer(1, 10 * mm))
    elements.append(Paragraph(
        f'Documento generado automaticamente por SYSPCC - {datetime.now().strftime("%d/%m/%Y %H:%M")}',
        ParagraphStyle('Footer', parent=styles['Normal'], fontSize=7,
                       alignment=TA_CENTER, textColor=colors.Color(0.6, 0.6, 0.6)),
    ))

    doc.build(elements)
    return buffer.getvalue()


def _get_signature_image(user):
    """Return a ReportLab Image of the user's signature, or empty string if none."""
    if not user or not user.signature:
        return ''
    try:
        sig_path = user.signature.path
        if os.path.exists(sig_path):
            return Image(sig_path, width=40 * mm, height=15 * mm, kind='proportional')
    except Exception:
        pass
    return ''


def _field(label, value, styles):
    """Helper to create a label+value block for the info table."""
    return Paragraph(
        f'<font size="8" color="#999999">{label}</font><br/>'
        f'<font size="10"><b>{value}</b></font>',
        styles['Normal'],
    )


def get_movement_filename(movement) -> str:
    """
    Generate a descriptive filename for the movement PDF.
    E.g. "ENT-2026-0001_2026-04-13_Cemento-Portland-Tipo-I.pdf"
    """
    date_str = movement.created_at.strftime('%Y-%m-%d')
    desc = movement.inventory.description[:40]
    # Make filename safe
    safe_desc = ''.join(c if c.isalnum() or c in ' -_' else '' for c in desc)
    safe_desc = safe_desc.strip().replace(' ', '-')
    return f'{movement.movement_number}_{date_str}_{safe_desc}.pdf'


def get_month_folder(movement) -> str:
    """
    Return the OneDrive folder path for this movement.
    Structure:
      Documentos/SYSPCC-Almacen/Entradas/2026-04 Abril/
      Documentos/SYSPCC-Almacen/Salidas/2026-04 Abril/
    """
    MONTH_NAMES = {
        1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
        5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
        9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
    }
    dt = movement.created_at
    month_name = MONTH_NAMES.get(dt.month, '')
    type_folder = 'Entradas' if movement.movement_type == 'ENTRY' else 'Salidas'
    return f'Documentos/SYSPCC-Almacen/{dt.year}-{dt.month:02d} {month_name}/{type_folder}'


# ---------------------------------------------------------------------------
# Multi-item group PDF
# ---------------------------------------------------------------------------

def generate_group_pdf(group) -> bytes:
    """
    Generate a PDF voucher for a MovementGroup (one or more items).
    Returns the PDF content as bytes.
    The group must have its 'movements' and 'movements__inventory' prefetched
    or they will be fetched lazily.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        'GroupDocTitle',
        parent=styles['Title'],
        fontSize=16,
        spaceAfter=2 * mm,
    ))
    styles.add(ParagraphStyle(
        'GroupDocSubtitle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.grey,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        'GroupSmallCenter',
        parent=styles['Normal'],
        fontSize=8,
        alignment=TA_CENTER,
        textColor=colors.Color(0.5, 0.5, 0.5),
    ))

    elements = []
    is_entry = group.movement_type == 'ENTRY'
    doc_type = 'VALE DE ENTRADA' if is_entry else 'VALE DE SALIDA'

    # ── Header ────────────────────────────────────────────────────────────
    logo_path = os.path.join(settings.BASE_DIR, 'static', 'images', 'pcc_logo.png')
    if os.path.exists(logo_path):
        logo = Image(logo_path, width=30 * mm, height=15 * mm, kind='proportional')
        header_data = [[
            logo,
            Paragraph(
                '<b>PCC S.A.C.</b><br/>'
                '<font size="8" color="#888888">Proyectos, Construccion &amp; Comisionamiento</font>',
                ParagraphStyle('GHeaderText', parent=styles['Normal'], fontSize=14, leading=18),
            ),
        ]]
        header_table = Table(header_data, colWidths=[35 * mm, doc.width - 35 * mm])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (0, 0), 0),
        ]))
        elements.append(header_table)
    else:
        elements.append(Paragraph('PCC S.A.C.', styles['GroupDocTitle']))
        elements.append(Paragraph(
            'Proyectos, Construccion & Comisionamiento',
            styles['GroupDocSubtitle'],
        ))
    elements.append(Spacer(1, 6 * mm))

    # ── Document title & number ───────────────────────────────────────────
    title_data = [[
        Paragraph(f'<b>{doc_type}</b>', ParagraphStyle(
            'GTitleLeft', parent=styles['Normal'], fontSize=14,
        )),
        Paragraph(
            f'<b>{group.group_number}</b>',
            ParagraphStyle('GTitleRight', parent=styles['Normal'],
                           fontSize=12, alignment=TA_RIGHT,
                           textColor=colors.Color(0.2, 0.2, 0.2)),
        ),
    ]]
    title_table = Table(title_data, colWidths=[doc.width * 0.6, doc.width * 0.4])
    title_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 0), (-1, 0), 1.5, colors.Color(0.1, 0.1, 0.1)),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
    ]))
    elements.append(title_table)
    elements.append(Spacer(1, 5 * mm))

    # ── Info block ────────────────────────────────────────────────────────
    date_str = group.created_at.strftime('%d/%m/%Y %H:%M')
    wh_label = WAREHOUSE_LABELS.get(group.warehouse, group.warehouse)
    project_name = group.project.name if group.project else '-'

    info_rows = [
        [_field('Fecha', date_str, styles), _field('Almacen', wh_label, styles)],
        [_field('Proyecto', project_name, styles), ''],
    ]

    if is_entry:
        source = SOURCE_LABELS.get(group.source_type, group.source_type)
        info_rows[1][1] = _field('Origen', source, styles)
        if group.supplier_name:
            info_rows.append([
                _field('Proveedor', group.supplier_name, styles),
                _field('N. Factura / Guia', group.invoice_number or '-', styles),
            ])
    else:
        dest = DEST_LABELS.get(group.destination_type, group.destination_type)
        info_rows[1][1] = _field('Tipo destino', dest, styles)
        if group.destination_detail:
            info_rows.append([
                _field('Destino', group.destination_detail, styles),
                '',
            ])

    info_table = Table(info_rows, colWidths=[doc.width * 0.5, doc.width * 0.5])
    info_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 6 * mm))

    # ── Items table (multi-row) ────────────────────────────────────────────
    item_header = ['#', 'Codigo', 'Descripcion', 'Unidad', 'Cantidad']
    rows = [item_header]

    movements = list(group.movements.select_related('inventory').order_by('movement_number'))
    for idx, mv in enumerate(movements, start=1):
        rows.append([
            str(idx),
            mv.inventory.product_code,
            mv.inventory.description,
            mv.inventory.unit.capitalize(),
            f'{mv.quantity:,.3f}',
        ])

    col_widths = [
        doc.width * 0.05,
        doc.width * 0.16,
        doc.width * 0.45,
        doc.width * 0.14,
        doc.width * 0.20,
    ]
    item_table = Table(rows, colWidths=col_widths)

    table_style = [
        # Header row
        ('BACKGROUND', (0, 0), (-1, 0), colors.Color(0.12, 0.12, 0.12)),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('TOPPADDING', (0, 0), (-1, 0), 7),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 7),
        # Data rows
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
        # Alternating row colours
        ('ROWBACKGROUNDS', (0, 1), (-1, -1),
         [colors.Color(0.97, 0.97, 0.97), colors.white]),
        # Alignment
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),   # # column
        ('ALIGN', (4, 0), (4, -1), 'RIGHT'),    # Cantidad column
        # Grid
        ('GRID', (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.85, 0.85)),
    ]
    item_table.setStyle(TableStyle(table_style))
    elements.append(item_table)

    # ── Notes ─────────────────────────────────────────────────────────────
    if group.notes:
        elements.append(Spacer(1, 5 * mm))
        elements.append(Paragraph(
            f'<b>Observaciones:</b> {group.notes}',
            ParagraphStyle('GNotes', parent=styles['Normal'], fontSize=9,
                           textColor=colors.Color(0.3, 0.3, 0.3)),
        ))

    # ── Signature block ───────────────────────────────────────────────────
    elements.append(Spacer(1, 15 * mm))

    registered_name = group.registered_by.get_full_name()
    reg_sig = _get_signature_image(group.registered_by)

    sig_data = [
        [reg_sig, '', ''],
        ['____________________', '____________________', '____________________'],
        [
            Paragraph('<b>Entrego</b>', styles['GroupSmallCenter']),
            Paragraph('<b>Recibio</b>', styles['GroupSmallCenter']),
            Paragraph('<b>Autorizo</b>', styles['GroupSmallCenter']),
        ],
        [
            Paragraph(registered_name, styles['GroupSmallCenter']),
            Paragraph('', styles['GroupSmallCenter']),
            Paragraph('', styles['GroupSmallCenter']),
        ],
    ]
    sig_table = Table(sig_data, colWidths=[doc.width / 3] * 3)
    sig_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, 0), 'BOTTOM'),
        ('TOPPADDING', (0, 2), (-1, 2), 4),
        ('TOPPADDING', (0, 3), (-1, 3), 2),
    ]))
    elements.append(sig_table)

    # ── Footer ────────────────────────────────────────────────────────────
    elements.append(Spacer(1, 10 * mm))
    elements.append(Paragraph(
        f'Documento generado automaticamente por SYSPCC - {datetime.now().strftime("%d/%m/%Y %H:%M")}',
        ParagraphStyle('GFooter', parent=styles['Normal'], fontSize=7,
                       alignment=TA_CENTER, textColor=colors.Color(0.6, 0.6, 0.6)),
    ))

    doc.build(elements)
    return buffer.getvalue()


def get_group_filename(group) -> str:
    """
    Generate a descriptive filename for a group PDF.
    E.g. "ENT-2026-G0001_2026-04-13_3-items.pdf"
    """
    date_str = group.created_at.strftime('%Y-%m-%d')
    item_count = group.movements.count()
    return f'{group.group_number}_{date_str}_{item_count}-items.pdf'


def get_group_month_folder(group) -> str:
    """
    Return the OneDrive folder path for a group PDF.
    Structure mirrors get_month_folder — same directory, consistent browsing.
    """
    MONTH_NAMES = {
        1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
        5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
        9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
    }
    dt = group.created_at
    month_name = MONTH_NAMES.get(dt.month, '')
    type_folder = 'Entradas' if group.movement_type == 'ENTRY' else 'Salidas'
    return f'Documentos/SYSPCC-Almacen/{dt.year}-{dt.month:02d} {month_name}/{type_folder}'
