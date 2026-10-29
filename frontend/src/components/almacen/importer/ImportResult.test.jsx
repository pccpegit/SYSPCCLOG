import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import ImportResult from './ImportResult';

// SYSPCC-025 · QA ronda 1.
// Forma REAL del `result` que devuelve `POST imports/{id}/confirm/` (apps/warehouse/services/imports/applier.py):
// `groups`, `movements` y `skipped` son OBJETOS, no números.
const BACKEND_RESULT = {
  catalog: { created: 254, updated: 0 },
  groups: { initial: 0, entries: 4, exits: 403 },
  movements: { initial: 0, entries: 239, exits: 459 },
  skipped: { rows_with_errors: 37, already_imported: 0 },
  stock_total: 6913,
  reconciled: false,
  confirmed_by: 1,
};

const status = () => screen.getByRole('status', { name: '' });

describe('ImportResult — con la respuesta real del servidor', () => {
  // DEFECTO QA-11: la pantalla hace `formatQty(result.groups)` sobre un objeto => NaN => "0".
  // Tras importar 698 movimientos anuncia "0 vales, 0 movimientos. 0 filas omitidas".
  it('anuncia los totales reales de vales y movimientos, no ceros', () => {
    renderWithProviders(<ImportResult result={BACKEND_RESULT} replay={false} onAnother={vi.fn()} />);
    const text = status().textContent;
    expect(text).toMatch(/254 ítems/);
    expect(text).toMatch(/407 vales/);
    expect(text).toMatch(/698 movimientos/);
    expect(text).not.toMatch(/\b0 vales\b/);
    expect(text).not.toMatch(/\b0 movimientos\b/);
  });

  it('anuncia las filas omitidas por error', () => {
    renderWithProviders(<ImportResult result={BACKEND_RESULT} replay={false} onAnother={vi.fn()} />);
    expect(status().textContent).toMatch(/37 filas omitidas/);
  });

  it('nunca muestra NaN, undefined ni [object Object]', () => {
    renderWithProviders(<ImportResult result={BACKEND_RESULT} replay={false} onAnother={vi.fn()} />);
    expect(document.body.textContent).not.toMatch(/NaN|undefined|\[object Object\]/);
  });
});

describe('ImportResult — mensajes', () => {
  const flat = { catalog: { created: 1, updated: 0 }, groups: 1, movements: 1, skipped: 1 };

  it('usa el singular cuando corresponde', () => {
    renderWithProviders(<ImportResult result={flat} replay={false} onAnother={vi.fn()} />);
    expect(status()).toHaveTextContent('Importación completada: 1 ítem, 1 vale, 1 movimiento. 1 fila omitida.');
  });

  it('suma ítems creados y actualizados', () => {
    renderWithProviders(
      <ImportResult result={{ ...flat, catalog: { created: 10, updated: 5 } }} replay={false} onAnother={vi.fn()} />,
    );
    expect(status().textContent).toMatch(/15 ítems/);
  });

  it('con una respuesta vacía no se rompe y muestra ceros', () => {
    renderWithProviders(<ImportResult result={{}} replay={false} onAnother={vi.fn()} />);
    expect(status()).toHaveTextContent('Importación completada: 0 ítems, 0 vales, 0 movimientos. 0 filas omitidas.');
  });

  it('con result nulo tampoco se rompe', () => {
    renderWithProviders(<ImportResult result={null} replay={false} onAnother={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Importación completada' })).toBeInTheDocument();
  });

  it('distingue una confirmación repetida (replay)', () => {
    renderWithProviders(<ImportResult result={flat} replay onAnother={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /esta importación ya estaba confirmada/i })).toBeInTheDocument();
  });

  it.each([
    [true, /coincide con el del libro/i],
    [false, /difiere del del libro/i],
  ])('reconciled=%s muestra el aviso correspondiente', (reconciled, pattern) => {
    renderWithProviders(<ImportResult result={{ ...flat, reconciled }} replay={false} onAnother={vi.fn()} />);
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });

  it('reconciled=null (libro sin STOCK ACTUAL) no afirma nada sobre el stock', () => {
    renderWithProviders(<ImportResult result={{ ...flat, reconciled: null }} replay={false} onAnother={vi.fn()} />);
    expect(screen.queryByText(/coincide|difiere/i)).not.toBeInTheDocument();
  });

  it('ofrece los accesos de seguimiento y volver a importar', async () => {
    const onAnother = vi.fn();
    renderWithProviders(<ImportResult result={flat} replay={false} onAnother={onAnother} />);
    expect(screen.getByRole('link', { name: /ver resumen de movimiento/i })).toHaveAttribute('href', '/almacen/resumen');
    expect(screen.getByRole('link', { name: /ítems pendientes de ubicar/i })).toHaveAttribute('href', '/almacen/inventario?pendientes=1');
    await userEvent.setup().click(screen.getByRole('button', { name: /importar otro libro/i }));
    expect(onAnother).toHaveBeenCalledTimes(1);
  });
});

describe('ImportResult — foco y filas ya importadas', () => {
  it('el título recibe el foco y se describe con los totales (se lee al aparecer)', () => {
    renderWithProviders(<ImportResult result={BACKEND_RESULT} replay={false} onAnother={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: 'Importación completada' });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAccessibleDescription(/254 ítems, 407 vales, 698 movimientos\. 37 filas omitidas\./);
  });

  it('menciona aparte las filas que ya estaban importadas (no se duplican)', () => {
    const result = { ...BACKEND_RESULT, skipped: { rows_with_errors: 0, already_imported: 12 } };
    renderWithProviders(<ImportResult result={result} replay={false} onAnother={vi.fn()} />);
    expect(status().textContent).toMatch(/0 filas omitidas\./);
    expect(status().textContent).toMatch(/12 filas ya estaban importadas y no se duplicó\./);
  });

  it('una sola fila ya importada va en singular', () => {
    const result = { ...BACKEND_RESULT, skipped: { rows_with_errors: 1, already_imported: 1 } };
    renderWithProviders(<ImportResult result={result} replay={false} onAnother={vi.fn()} />);
    expect(status().textContent).toMatch(/1 fila omitida\./);
    expect(status().textContent).toMatch(/1 fila ya estaba importada y no se duplicó\./);
  });

  it('sin filas ya importadas no menciona nada de eso', () => {
    renderWithProviders(<ImportResult result={BACKEND_RESULT} replay={false} onAnother={vi.fn()} />);
    expect(status().textContent).not.toMatch(/ya estaba/);
  });
});
