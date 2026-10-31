import { describe, it, expect } from 'vitest';
import {
  parseMasterSearch, buildMasterSearch, buildApiParams, nextOrdering, ariaSortFor, formatMasterDate,
  formatPercent, formatMasterQty, describeOverrideError, describeExportError, describeLoadError,
  EXPORT_THROTTLED_MESSAGE, EMPTY_FILTERS,
} from './requestMaster';

const parse = (qs) => parseMasterSearch(new URLSearchParams(qs));
const httpError = (status, data) => ({ response: { status, data } });

describe('parseMasterSearch / buildMasterSearch', () => {
  it('sin parámetros devuelve los valores por defecto', () => {
    expect(parse('')).toEqual({ tab: 'item', filters: EMPTY_FILTERS, ordering: '', page: 1, pageSize: 25 });
  });

  it('descarta valores inválidos de la URL en vez de mandarlos al servidor', () => {
    const r = parse('tab=otra&project=abc&area=XX&source=EPP&item_status=NADA&stage=CERRADO&approved_from=ayer&with_shortage=true&page=-3&page_size=7&ordering=percent');
    expect(r.tab).toBe('item');
    expect(r.filters.project).toBe('');
    expect(r.filters.area).toBe('');
    expect(r.filters.source).toBe('EPP');
    expect(r.filters.item_status).toBe('');
    expect(r.filters.stage).toBe('CERRADO');
    expect(r.filters.approved_from).toBe('');
    expect(r.filters.with_shortage).toBe('');
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(25);
    expect(r.ordering).toBe(''); // `percent` solo vale en «Por RQ»
  });

  it('el orden válido depende de la pestaña', () => {
    expect(parse('ordering=-percent').ordering).toBe('');
    expect(parse('tab=rq&ordering=-percent').ordering).toBe('-percent');
    expect(parse('ordering=-missing').ordering).toBe('-missing');
  });

  it('recorta la búsqueda a 100 caracteres', () => {
    expect(parse(`search=${'a'.repeat(150)}`).filters.search).toHaveLength(100);
  });

  it('ida y vuelta: solo escribe lo que se aparta del valor por defecto', () => {
    const state = { tab: 'rq', filters: { ...EMPTY_FILTERS, project: '7', with_alerts: '1' }, ordering: '-percent', page: 3, pageSize: 50 };
    const qs = buildMasterSearch(state).toString();
    expect(qs).toBe('tab=rq&project=7&with_alerts=1&ordering=-percent&page=3&page_size=50');
    expect(parse(qs)).toEqual(state);
    expect(buildMasterSearch({ tab: 'item', filters: EMPTY_FILTERS, ordering: '', page: 1, pageSize: 25 }).toString()).toBe('');
  });
});

describe('buildApiParams', () => {
  it('omite vacíos y convierte las banderas a true', () => {
    const filters = { ...EMPTY_FILTERS, project: '7', with_shortage: '1', search: 'casco' };
    expect(buildApiParams(filters, { ordering: '', page: 2, page_size: 25 })).toEqual({
      project: '7', with_shortage: 'true', search: 'casco', page: 2, page_size: 25,
    });
  });
});

describe('orden', () => {
  it('cicla asc -> desc -> sin orden', () => {
    expect(nextOrdering('', 'need_date')).toBe('need_date');
    expect(nextOrdering('need_date', 'need_date')).toBe('-need_date');
    expect(nextOrdering('-need_date', 'need_date')).toBe('');
    expect(nextOrdering('rq_number', 'need_date')).toBe('need_date');
  });
  it('aria-sort refleja el sentido', () => {
    expect(ariaSortFor('quantity', 'quantity')).toBe('ascending');
    expect(ariaSortFor('-quantity', 'quantity')).toBe('descending');
    expect(ariaSortFor('missing', 'quantity')).toBe('none');
  });
});

describe('presentación', () => {
  it('una fecha sola no se corre un día por la zona horaria', () => {
    expect(formatMasterDate('2026-10-01')).toBe('01/10/2026');
  });
  it('un instante se muestra en hora de Lima', () => {
    expect(formatMasterDate('2026-10-02T03:00:00Z')).toBe('01/10/2026');
  });
  it('vacíos y basura se muestran como raya', () => {
    expect(formatMasterDate(null)).toBe('—');
    expect(formatMasterDate('no-es-fecha')).toBe('—');
    expect(formatMasterQty(null)).toBe('—');
    expect(formatMasterQty('10.000')).toBe('10');
    expect(formatMasterQty('-1.500')).toBe('-1.5');
  });
  it('porcentaje', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(40)).toBe('40 %');
    expect(formatPercent(33.333)).toBe('33.3 %');
  });
});

describe('mensajes de error', () => {
  it('429 del Excel', async () => {
    expect(await describeExportError(httpError(429))).toBe(EXPORT_THROTTLED_MESSAGE);
  });
  it('400 del Excel llega como Blob y se lee su detalle', async () => {
    const blob = new Blob([JSON.stringify({ detail: 'Rango de fechas inválido.' })], { type: 'application/json' });
    expect(await describeExportError(httpError(400, blob))).toBe('Rango de fechas inválido.');
  });
  it('error de red del Excel', async () => {
    expect(await describeExportError(new Error('Network'))).toMatch(/No se pudo descargar/);
  });
  it('override: 409 terminal usa la frase del servidor, 403 y 400 tienen la suya', () => {
    expect(describeOverrideError(httpError(409, { code: 'REQUEST_TERMINAL', detail: 'El RQ está cerrado.' }))).toBe('El RQ está cerrado.');
    expect(describeOverrideError(httpError(403, { detail: 'x' }))).toMatch(/No tiene permiso/);
    expect(describeOverrideError(httpError(400, { detail: { note: ['Indique el motivo.'] } }))).toBe('Indique el motivo.');
    expect(describeOverrideError(new Error('x'))).toMatch(/No se pudo guardar/);
  });
  it('carga: 400 muestra el detalle del servidor y 404 explica la página', () => {
    expect(describeLoadError(httpError(400, { detail: 'Filtro inválido.' }))).toBe('Filtro inválido.');
    expect(describeLoadError(httpError(404, { detail: 'Invalid page.' }))).toMatch(/página/);
    expect(describeLoadError(httpError(500, 'boom'))).toMatch(/No se pudo cargar/);
  });
});
