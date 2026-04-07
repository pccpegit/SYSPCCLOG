import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

/**
 * Downloads the official RQ Excel template filled with form data.
 *
 * Cell mapping matches "FORMATO RQ.xlsx":
 *   C5  = Requerido por (nombre)
 *   H5  = N° Requerimiento
 *   C6  = Uso específico
 *   H6  = Fecha de requerimiento (DD/MM/YYYY)
 *   C7  = Área
 *   H7  = Frente
 *   C8  = Fecha de entrega
 *   H8  = Servicio
 *   C9  = Tipo de pedido
 *   A12..A34 = Items (rows 12-34, up to 23 items)
 *     Col C = Descripción (Equipos/Unidades)
 *     Col D = Unidad de medida
 *     Col E = Cantidad
 *     Col F = Stock almacén obra
 *     Col G = Stock almacén principal
 *     Col H = X Atender
 *     Col I = Presupuestado / Adicional
 *     Col J = RFI / FWO
 *     Col K = Estatus / Guía
 *     Col L = Comentarios
 *   A36/C36 = Realizado por
 *   A40     = Fecha realizado
 */

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function calcXAtender(item) {
  if (item.xAtenderManual) return Number(item.xAtender) || 0;
  const qty  = parseFloat(item.cantidad)              || 0;
  const obra = parseFloat(item.stockAlmacenObra)      || 0;
  const ppal = parseFloat(item.stockAlmacenPrincipal) || 0;
  const val  = qty - obra - ppal;
  return val < 0 ? 0 : val;
}

export async function exportRQToExcel({ form, items, currentUser, rqNumber }) {
  // Fetch the template
  const response = await fetch('/excel/FORMATO_RQ.xlsx');
  const arrayBuffer = await response.arrayBuffer();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const ws = workbook.getWorksheet('RQ') || workbook.worksheets[0];

  // ── Header fields ───────────────────────────────────────────
  ws.getCell('C5').value  = currentUser?.name || '';
  ws.getCell('H5').value  = rqNumber || '';
  ws.getCell('C6').value  = form.usoEspecifico || '';
  ws.getCell('H6').value  = fmtDate(form.fechaRequerimiento);
  ws.getCell('C7').value  = form.area || '';
  ws.getCell('H7').value  = form.frente || '';
  ws.getCell('C8').value  = fmtDate(form.fechaEntrega);
  ws.getCell('H8').value  = form.servicio || '';
  ws.getCell('C9').value  = form.tipoPedido || '';

  // ── Items (rows 12 through 34 — max 23 items) ──────────────
  const filledItems = items.filter((i) => i.descripcion.trim());
  const startRow = 12;
  const maxItems = 23;

  filledItems.slice(0, maxItems).forEach((item, idx) => {
    const row = startRow + idx;
    ws.getCell(`C${row}`).value  = item.descripcion;
    ws.getCell(`D${row}`).value  = item.unidad;
    ws.getCell(`E${row}`).value  = Number(item.cantidad) || 0;
    ws.getCell(`F${row}`).value  = Number(item.stockAlmacenObra) || 0;
    ws.getCell(`G${row}`).value  = Number(item.stockAlmacenPrincipal) || 0;
    ws.getCell(`H${row}`).value  = calcXAtender(item);
    ws.getCell(`I${row}`).value  = item.presupuestadoAdicional === 'P' ? 'Presupuestado' : 'Adicional';
    ws.getCell(`J${row}`).value  = item.rfiFwo || '';
    ws.getCell(`K${row}`).value  = item.estatusGuia || '';
    ws.getCell(`L${row}`).value  = item.comentarios || '';
  });

  // ── Signature section ───────────────────────────────────────
  ws.getCell('C36').value = currentUser?.name || '';
  ws.getCell('A40').value = fmtDate(form.fechaRequerimiento);

  // ── Generate & download ─────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  const blob   = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const fileName = rqNumber
    ? `${rqNumber.replace(/\//g, '-')}.xlsx`
    : `RQ-${fmtDate(form.fechaRequerimiento)}.xlsx`;

  saveAs(blob, fileName);
}
